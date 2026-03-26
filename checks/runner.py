import logging
from dataclasses import asdict
from pathlib import Path

import pandas as pd
import yaml

from checks.base import BaseCheck, CheckResult
from checks.fix_generator import FixGenerator
from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.referential_check import ReferentialCheck
from checks.types.freshness_check import FreshnessCheck

logger = logging.getLogger("meridian.checks")

REGISTRY: dict[str, type[BaseCheck]] = {
    "null_check": NullCheck,
    "regex_check": RegexCheck,
    "domain_value_check": DomainValueCheck,
    "cross_field_check": CrossFieldCheck,
    "referential_check": ReferentialCheck,
    "freshness_check": FreshnessCheck,
}

RULES_DIR = Path(__file__).parent / "rules"
CATEGORIES = ["ecc", "successfactors", "warehouse"]


def _find_module_yaml(module_name: str) -> Path:
    """Find the YAML rule file for a module across all category directories."""
    for category in CATEGORIES:
        path = RULES_DIR / category / f"{module_name}.yaml"
        if path.exists():
            return path
    raise FileNotFoundError(
        f"No YAML rule file found for module '{module_name}' in {RULES_DIR}. "
        f"Searched categories: {CATEGORIES}"
    )


def run_checks(module_name: str, df: pd.DataFrame, tenant_id: str) -> list[CheckResult]:
    """Load YAML rules for a module and run all checks against the DataFrame."""
    yaml_path = _find_module_yaml(module_name)

    with open(yaml_path, "r") as f:
        config = yaml.safe_load(f)

    rules = config.get("rules", [])
    module = config.get("module", module_name)
    results: list[CheckResult] = []

    for rule in rules:
        # Inject module name into each rule dict
        rule["module"] = module

        check_class_name = rule.get("check_class", "")
        check_cls = REGISTRY.get(check_class_name)

        if check_cls is None:
            logger.warning(f"Unknown check_class '{check_class_name}' in rule {rule.get('id')}")
            results.append(
                CheckResult(
                    check_id=rule.get("id", "UNKNOWN"),
                    module=module,
                    field=rule.get("field", ""),
                    severity=rule.get("severity", "medium"),
                    dimension=rule.get("dimension", ""),
                    passed=False,
                    affected_count=0,
                    total_count=len(df),
                    pass_rate=0.0,
                    message=rule.get("message", ""),
                    details={},
                    error=f"Unknown check_class: {check_class_name}",
                )
            )
            continue

        try:
            check = check_cls(rule)
            result = check.run(df)
            results.append(result)
        except Exception as e:
            logger.error(f"Exception in check {rule.get('id')}: {e}", exc_info=True)
            results.append(
                CheckResult(
                    check_id=rule.get("id", "UNKNOWN"),
                    module=module,
                    field=rule.get("field", ""),
                    severity=rule.get("severity", "medium"),
                    dimension=rule.get("dimension", ""),
                    passed=False,
                    affected_count=0,
                    total_count=len(df),
                    pass_rate=0.0,
                    message=rule.get("message", ""),
                    details={},
                    error=str(e),
                )
            )

    logger.info(f"Module '{module}': ran {len(results)} checks, {sum(1 for r in results if r.passed)} passed")

    # Enrich failing results with deterministic fix recommendations
    fix_gen = FixGenerator()
    for i, result in enumerate(results):
        if result.passed or result.error:
            continue

        try:
            rule = rules[i]

            # Build rule_context from YAML fields
            rule_context: dict = {}
            for key in ("why_it_matters", "rule_authority", "sap_impact", "valid_values_with_labels"):
                if rule.get(key):
                    rule_context[key] = rule[key]

            fix_map = rule.get("fix_map", {})
            if not fix_map:
                results[i] = result.model_copy(update={"rule_context": rule_context or None})
                continue

            # Build value_fix_map from distinct_invalid_values in details
            value_fix_map = None
            distinct = result.details.get("distinct_invalid_values", {})
            if distinct:
                vfm = fix_gen.build_value_fix_map(
                    distinct, fix_map, rule.get("valid_values_with_labels")
                )
                value_fix_map = {k: asdict(v) for k, v in vfm.items()}

            # Build record_fixes from sample_failing_records in details
            record_fixes = None
            samples = result.details.get("sample_failing_records", [])
            if samples:
                table_name = rule["field"].split(".")[0] if "." in rule["field"] else None
                check_field = rule["field"].split(".")[-1] if "." in rule["field"] else rule["field"]
                id_field = result.details.get("id_field_used", df.columns[0])
                rf_list = fix_gen.build_record_fixes(
                    sample_failing_records=samples,
                    id_field=id_field,
                    check_field=check_field,
                    fix_map=fix_map,
                    record_fix_template=rule.get("record_fix_template"),
                    table_name=table_name,
                )
                record_fixes = [asdict(rf) for rf in rf_list]

            results[i] = result.model_copy(update={
                "rule_context": rule_context or None,
                "value_fix_map": value_fix_map,
                "record_fixes": record_fixes,
            })
        except Exception as e:
            logger.warning(f"Fix enrichment failed for {result.check_id}: {e}")

    return results
