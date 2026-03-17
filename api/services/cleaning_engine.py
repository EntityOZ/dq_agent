"""Cleaning Engine — detects cleaning candidates across 5 categories.

Uses jellyfish for fuzzy string matching, thefuzz for token overlap.
Pure detection — no database writes, returns candidate dicts for bulk insert.
"""

import logging
from datetime import datetime, timezone

import jellyfish
import pandas as pd
from thefuzz import fuzz

from api.services.standardisers import (
    country_code,
    legal_suffix,
    material_description,
    sa_phone_number,
    sap_uom,
    title_case,
    validate_sa_bank_branch,
    validate_sa_id,
)

logger = logging.getLogger("vantax.cleaning")

# Column name patterns per object type
_NAME_COLS = ["name", "partner_name", "vendor_name", "customer_name", "bp_name"]
_PHONE_COLS = ["phone", "telephone", "tel", "phone_number", "tel_number"]
_COUNTRY_COLS = ["country", "country_code", "land1"]
_UOM_COLS = ["uom", "base_unit", "base_uom", "meins"]
_EMAIL_COLS = ["email", "smtp_addr", "email_address"]
_ID_COLS = ["id_number", "sa_id", "national_id"]
_VAT_COLS = ["vat_number", "vat_no", "stceg"]
_BRANCH_COLS = ["branch_code", "bank_branch", "bankl"]
_DESC_COLS = ["description", "material_description", "maktx"]
_PAYMENT_COLS = ["payment_terms", "zterm"]
_CURRENCY_COLS = ["currency", "waers"]
_TAX_COLS = ["tax_number", "stcd1", "vat_number"]
_BANK_ACCT_COLS = ["bank_account", "bankn"]
_MATERIAL_GROUP_COLS = ["material_group", "matkl"]
_BASE_UNIT_COLS = ["base_unit", "meins", "base_uom"]
_ACTIVITY_COLS = ["last_activity", "modified_date", "last_changed", "aedat"]
_STATUS_COLS = ["status", "block_status", "sperr"]
_TERMINATION_COLS = ["termination_date", "term_date"]
_STOCK_COLS = ["stock_quantity", "labst", "stock"]
_PRICE_COLS = ["price", "stprs", "verpr"]


def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    """Find first matching column name (case-insensitive)."""
    df_lower = {c.lower(): c for c in df.columns}
    for c in candidates:
        if c.lower() in df_lower:
            return df_lower[c.lower()]
    return None


def _record_key(row: pd.Series, df: pd.DataFrame) -> str:
    """Build a record key from the first plausible key column or index."""
    for col in ["partner", "bp_number", "material", "matnr", "employee_id", "pernr", "id"]:
        actual = _find_col(df, [col])
        if actual and pd.notna(row.get(actual)):
            return str(row[actual])
    return str(row.name)


class CleaningEngine:
    """Detect cleaning candidates across five categories."""

    def detect_candidates(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Run all five detection categories. Returns candidate dicts for cleaning_queue."""
        candidates: list[dict] = []

        try:
            candidates.extend(self.detect_duplicates(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_duplicates failed: {e}")

        try:
            candidates.extend(self.detect_standardisation_issues(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_standardisation_issues failed: {e}")

        try:
            candidates.extend(self.detect_enrichment_gaps(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_enrichment_gaps failed: {e}")

        try:
            candidates.extend(self.detect_validation_errors(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_validation_errors failed: {e}")

        try:
            candidates.extend(self.detect_lifecycle_issues(df, object_type, version_id, tenant_id))
        except Exception as e:
            logger.warning(f"detect_lifecycle_issues failed: {e}")

        return candidates

    def detect_duplicates(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 1: O(n^2) pairwise dedup detection."""
        results: list[dict] = []
        name_col = _find_col(df, _NAME_COLS)
        email_col = _find_col(df, _EMAIL_COLS)
        tax_col = _find_col(df, _TAX_COLS)
        bank_col = _find_col(df, _BANK_ACCT_COLS)

        if not name_col and not email_col and not tax_col and not bank_col:
            return results

        # Limit to first 500 rows to keep O(n^2) feasible
        subset = df.head(500)
        seen_pairs: set[tuple[int, int]] = set()

        for i in range(len(subset)):
            for j in range(i + 1, len(subset)):
                if (i, j) in seen_pairs:
                    continue

                row_a = subset.iloc[i]
                row_b = subset.iloc[j]
                score = 0
                method = ""
                match_fields: dict[str, dict] = {}

                # Exact match on tax_number, bank_account, or email
                for col, col_name in [(tax_col, "tax_number"), (bank_col, "bank_account"), (email_col, "email")]:
                    if col and pd.notna(row_a.get(col)) and pd.notna(row_b.get(col)):
                        val_a = str(row_a[col]).strip()
                        val_b = str(row_b[col]).strip()
                        if val_a and val_b and val_a.lower() == val_b.lower():
                            score = max(score, 95)
                            method = "exact"
                            match_fields[col_name] = {"a": val_a, "b": val_b, "method": "exact"}

                # Name-based matching
                if name_col and pd.notna(row_a.get(name_col)) and pd.notna(row_b.get(name_col)):
                    name_a = str(row_a[name_col]).strip()
                    name_b = str(row_b[name_col]).strip()

                    if name_a and name_b and len(name_a) > 5 and len(name_b) > 5:
                        # Levenshtein
                        lev_dist = jellyfish.levenshtein_distance(name_a.lower(), name_b.lower())
                        if lev_dist <= 3:
                            if score < 80:
                                score = 80
                                method = method or "fuzzy"
                            match_fields["name_levenshtein"] = {"a": name_a, "b": name_b, "distance": lev_dist}

                        # Soundex
                        if jellyfish.soundex(name_a) == jellyfish.soundex(name_b):
                            if score < 70:
                                score = 70
                                method = method or "phonetic"
                            match_fields["name_soundex"] = {"a": name_a, "b": name_b, "soundex": jellyfish.soundex(name_a)}

                        # Token overlap (Jaccard)
                        tokens_a = set(name_a.lower().split())
                        tokens_b = set(name_b.lower().split())
                        if tokens_a and tokens_b:
                            jaccard = len(tokens_a & tokens_b) / len(tokens_a | tokens_b) * 100
                            if jaccard > 80:
                                if score < 75:
                                    score = 75
                                    method = method or "token_overlap"
                                match_fields["name_token_overlap"] = {"a": name_a, "b": name_b, "jaccard": round(jaccard, 1)}

                if score < 60:
                    continue

                seen_pairs.add((i, j))
                key_a = _record_key(row_a, df)
                key_b = _record_key(row_b, df)

                # Build merge preview — prefer non-empty, longer value
                merge_preview: dict[str, dict] = {}
                for col in df.columns:
                    val_a = row_a.get(col)
                    val_b = row_b.get(col)
                    str_a = str(val_a) if pd.notna(val_a) else ""
                    str_b = str(val_b) if pd.notna(val_b) else ""
                    survivor = str_a if len(str_a) >= len(str_b) else str_b
                    merge_preview[col] = {"a": str_a, "b": str_b, "survivor": survivor}

                results.append({
                    "object_type": object_type,
                    "status": "detected",
                    "record_key": f"{key_a}|{key_b}",
                    "record_data_before": {"record_a": key_a, "record_b": key_b},
                    "record_data_after": None,
                    "confidence": score,
                    "rule_id": None,
                    "version_id": version_id,
                    "tenant_id": tenant_id,
                    "priority": 70 if score >= 85 else 50,
                    "merge_preview": merge_preview,
                    "match_method": method,
                    "match_fields": match_fields,
                    "category": "dedup",
                })

        return results

    def detect_standardisation_issues(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 2: Apply standardisers and flag differences."""
        results: list[dict] = []

        # Map columns to standardiser functions
        mappings: list[tuple[list[str], callable, int]] = [
            (_PHONE_COLS, sa_phone_number, 90),
            (_COUNTRY_COLS, country_code, 90),
        ]

        if object_type in ("customer", "vendor", "business_partner"):
            mappings.append((_NAME_COLS, lambda v: title_case(v), 75))
            mappings.append((_UOM_COLS, sap_uom, 85))

        if object_type == "material":
            mappings.append((_DESC_COLS, material_description, 80))
            mappings.append((_UOM_COLS, sap_uom, 85))

        for col_candidates, func, confidence in mappings:
            col = _find_col(df, col_candidates)
            if not col:
                continue

            for idx, row in df.iterrows():
                val = row.get(col)
                if pd.isna(val) or not str(val).strip():
                    continue

                original = str(val)
                standardised = func(original)

                if standardised != original:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {col: original},
                        "record_data_after": {col: standardised},
                        "confidence": confidence,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 40,
                        "merge_preview": None,
                        "category": "standardisation",
                    })

        return results

    def detect_enrichment_gaps(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 3: Flag missing fields that should be populated."""
        results: list[dict] = []

        # Define checks per object type: (column_candidates, confidence, default_value_or_None)
        checks: list[tuple[list[str], int, str | None]] = []

        if object_type in ("business_partner", "customer", "vendor"):
            checks = [
                (_PAYMENT_COLS, 80, None),
                (_CURRENCY_COLS, 90, "ZAR"),
                (_COUNTRY_COLS, 85, "ZA"),
            ]
        elif object_type == "material":
            checks = [
                (_BASE_UNIT_COLS, 95, None),
                (_MATERIAL_GROUP_COLS, 70, None),
            ]

        for col_candidates, confidence, default_value in checks:
            col = _find_col(df, col_candidates)
            if not col:
                continue

            for idx, row in df.iterrows():
                val = row.get(col)
                if pd.isna(val) or str(val).strip() == "":
                    key = _record_key(row, df)
                    after = {col: default_value} if default_value else {}
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {col: None},
                        "record_data_after": after,
                        "confidence": confidence,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 30,
                        "merge_preview": None,
                        "category": "enrichment",
                    })

        return results

    def detect_validation_errors(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 4: SA-specific validation checks."""
        results: list[dict] = []

        # SA ID validation
        id_col = _find_col(df, _ID_COLS)
        if id_col:
            for idx, row in df.iterrows():
                val = row.get(id_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                check = validate_sa_id(str(val).strip())
                if not check["valid"]:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {id_col: str(val), "error": check["error"]},
                        "record_data_after": {},
                        "confidence": 95,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 60,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # SA VAT validation (10 digits starting with 4)
        vat_col = _find_col(df, _VAT_COLS)
        if vat_col:
            for idx, row in df.iterrows():
                val = row.get(vat_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                vat_str = str(val).strip()
                import re
                if not re.match(r"^4\d{9}$", vat_str):
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {vat_col: vat_str, "error": "must be 10 digits starting with 4"},
                        "record_data_after": {},
                        "confidence": 90,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 55,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # Bank branch validation
        branch_col = _find_col(df, _BRANCH_COLS)
        if branch_col:
            for idx, row in df.iterrows():
                val = row.get(branch_col)
                if pd.isna(val) or not str(val).strip():
                    continue
                check = validate_sa_bank_branch(str(val).strip())
                if not check["valid"]:
                    key = _record_key(row, df)
                    results.append({
                        "object_type": object_type,
                        "status": "detected",
                        "record_key": key,
                        "record_data_before": {branch_col: str(val)},
                        "record_data_after": {},
                        "confidence": 85,
                        "rule_id": None,
                        "version_id": version_id,
                        "tenant_id": tenant_id,
                        "priority": 45,
                        "merge_preview": None,
                        "category": "validation",
                    })

        # Numeric validation — zero/negative stock quantities, zero prices on active materials
        stock_col = _find_col(df, _STOCK_COLS)
        if stock_col:
            for idx, row in df.iterrows():
                val = row.get(stock_col)
                if pd.isna(val):
                    continue
                try:
                    num = float(val)
                    if num <= 0:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {stock_col: str(val), "issue": "zero or negative stock"},
                            "record_data_after": {},
                            "confidence": 80,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 40,
                            "merge_preview": None,
                            "category": "validation",
                        })
                except (ValueError, TypeError):
                    pass

        price_col = _find_col(df, _PRICE_COLS)
        if price_col and object_type == "material":
            status_col = _find_col(df, _STATUS_COLS)
            for idx, row in df.iterrows():
                val = row.get(price_col)
                if pd.isna(val):
                    continue
                try:
                    num = float(val)
                    if num == 0:
                        # Check if material is active (no block status)
                        is_active = True
                        if status_col:
                            s = row.get(status_col)
                            if pd.notna(s) and str(s).strip().lower() in ("blocked", "x", "1"):
                                is_active = False
                        if is_active:
                            key = _record_key(row, df)
                            results.append({
                                "object_type": object_type,
                                "status": "detected",
                                "record_key": key,
                                "record_data_before": {price_col: str(val), "issue": "zero price on active material"},
                                "record_data_after": {},
                                "confidence": 80,
                                "rule_id": None,
                                "version_id": version_id,
                                "tenant_id": tenant_id,
                                "priority": 40,
                                "merge_preview": None,
                                "category": "validation",
                            })
                except (ValueError, TypeError):
                    pass

        return results

    def detect_lifecycle_issues(
        self,
        df: pd.DataFrame,
        object_type: str,
        version_id: str,
        tenant_id: str,
    ) -> list[dict]:
        """Category 5: Activity-based lifecycle issues."""
        results: list[dict] = []
        now = datetime.now(timezone.utc)

        # Dormant records — last activity > 24 months ago
        activity_col = _find_col(df, _ACTIVITY_COLS)
        if activity_col:
            for idx, row in df.iterrows():
                val = row.get(activity_col)
                if pd.isna(val):
                    continue
                try:
                    dt = pd.to_datetime(val, utc=True)
                    months_ago = (now - dt).days / 30.44
                    if months_ago > 24:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {activity_col: str(val), "issue": "dormant", "months_inactive": round(months_ago)},
                            "record_data_after": {"suggested_action": "review for block"},
                            "confidence": 70,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 20,
                            "merge_preview": None,
                            "category": "lifecycle",
                        })
                except Exception:
                    pass

        # Archival candidates — status=blocked > 12 months
        status_col = _find_col(df, _STATUS_COLS)
        if status_col and activity_col:
            for idx, row in df.iterrows():
                s = row.get(status_col)
                if pd.isna(s) or str(s).strip().lower() not in ("blocked", "x", "1"):
                    continue
                val = row.get(activity_col)
                if pd.isna(val):
                    continue
                try:
                    dt = pd.to_datetime(val, utc=True)
                    months_ago = (now - dt).days / 30.44
                    if months_ago > 12:
                        key = _record_key(row, df)
                        results.append({
                            "object_type": object_type,
                            "status": "detected",
                            "record_key": key,
                            "record_data_before": {status_col: str(s), activity_col: str(val), "issue": "archival candidate"},
                            "record_data_after": {"suggested_action": "archive"},
                            "confidence": 65,
                            "rule_id": None,
                            "version_id": version_id,
                            "tenant_id": tenant_id,
                            "priority": 15,
                            "merge_preview": None,
                            "category": "lifecycle",
                        })
                except Exception:
                    pass

        # Access risk — terminated employees with active status
        if object_type == "employee":
            term_col = _find_col(df, _TERMINATION_COLS)
            emp_status_col = _find_col(df, _STATUS_COLS)
            if term_col and emp_status_col:
                for idx, row in df.iterrows():
                    term_val = row.get(term_col)
                    status_val = row.get(emp_status_col)
                    if pd.isna(term_val) or pd.isna(status_val):
                        continue
                    try:
                        term_dt = pd.to_datetime(term_val, utc=True)
                        if term_dt < now and str(status_val).strip().upper() == "A":
                            key = _record_key(row, df)
                            results.append({
                                "object_type": object_type,
                                "status": "detected",
                                "record_key": key,
                                "record_data_before": {
                                    term_col: str(term_val),
                                    emp_status_col: str(status_val),
                                    "issue": "access risk — terminated but active",
                                },
                                "record_data_after": {emp_status_col: "I", "suggested_action": "deactivate"},
                                "confidence": 95,
                                "rule_id": None,
                                "version_id": version_id,
                                "tenant_id": tenant_id,
                                "priority": 90,
                                "merge_preview": None,
                                "category": "lifecycle",
                            })
                    except Exception:
                        pass

        return results
