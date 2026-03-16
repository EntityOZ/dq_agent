import pandas as pd

from checks.base import BaseCheck, CheckResult


class CrossFieldCheck(BaseCheck):
    check_class = "cross_field_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            fields = self.rule.get("fields", [field])
            condition = self.rule["condition"]
            total = len(df)

            # Check all required fields exist
            missing = [f for f in fields if f not in df.columns]
            if missing:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "consistency"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={"condition": condition, "missing_fields": missing},
                    error=f"Missing columns: {missing}",
                )

            # Rows matching the condition are the PASSING rows
            passing_df = df.query(condition)
            passing_count = len(passing_df)
            affected = total - passing_count
            pass_rate = (passing_count / total * 100) if total > 0 else 0.0

            failing_indices = df.index.difference(passing_df.index).tolist()[:5]

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "consistency"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=total,
                pass_rate=round(pass_rate, 2),
                message=self.rule.get("message", ""),
                details={"condition": condition, "sample_failing_indices": failing_indices},
            )
        except Exception as e:
            return CheckResult(
                check_id=self.rule.get("id", "UNKNOWN"),
                module=self.rule.get("module", ""),
                field=self.rule.get("field", ""),
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "consistency"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )
