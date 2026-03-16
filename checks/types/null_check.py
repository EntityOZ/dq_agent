import pandas as pd

from checks.base import BaseCheck, CheckResult


class NullCheck(BaseCheck):
    check_class = "null_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            total = len(df)

            if field not in df.columns:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "completeness"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={"error": f"Column '{field}' not found in data"},
                    error=f"Column '{field}' not found",
                )

            null_mask = df[field].isna() | (df[field].astype(str).str.strip() == "")
            affected = int(null_mask.sum())
            non_null = total - affected
            pass_rate = (non_null / total * 100) if total > 0 else 0.0

            failing_indices = df.index[null_mask].tolist()[:5]

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "completeness"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=total,
                pass_rate=round(pass_rate, 2),
                message=self.rule.get("message", ""),
                details={"sample_failing_indices": failing_indices},
            )
        except Exception as e:
            return CheckResult(
                check_id=self.rule.get("id", "UNKNOWN"),
                module=self.rule.get("module", ""),
                field=self.rule.get("field", ""),
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "completeness"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )
