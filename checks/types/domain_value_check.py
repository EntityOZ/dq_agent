import re

import pandas as pd

from checks.base import BaseCheck, CheckResult

EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


class DomainValueCheck(BaseCheck):
    check_class = "domain_value_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            allowed_values = self.rule.get("allowed_values")
            fmt = self.rule.get("format")
            total = len(df)

            if field not in df.columns:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "validity"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={"error": f"Column '{field}' not found"},
                    error=f"Column '{field}' not found",
                )

            null_mask = df[field].isna()

            if allowed_values is not None:
                allowed_set = set(str(v) for v in allowed_values)
                values = df[field].astype(str)
                failing_mask = ~values.isin(allowed_set) | null_mask
            elif fmt == "email":
                values = df[field].astype(str).fillna("")
                failing_mask = ~values.apply(lambda x: bool(EMAIL_REGEX.match(x))) | null_mask
            elif fmt == "date":
                failing_mask = null_mask.copy()
                non_null_idx = df.index[~null_mask]
                for idx in non_null_idx:
                    try:
                        pd.to_datetime(df.at[idx, field])
                    except (ValueError, TypeError):
                        failing_mask.at[idx] = True
            else:
                # No validation criteria specified — null values still fail
                failing_mask = null_mask

            affected = int(failing_mask.sum())
            pass_rate = ((total - affected) / total * 100) if total > 0 else 0.0

            failing_values = df.loc[failing_mask, field].head(5).tolist()

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "validity"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=total,
                pass_rate=round(pass_rate, 2),
                message=self.rule.get("message", ""),
                details={
                    "allowed_values": allowed_values,
                    "sample_failing_values": [str(v) for v in failing_values],
                },
            )
        except Exception as e:
            return CheckResult(
                check_id=self.rule.get("id", "UNKNOWN"),
                module=self.rule.get("module", ""),
                field=self.rule.get("field", ""),
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "validity"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )
