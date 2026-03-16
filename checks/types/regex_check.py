import re

import pandas as pd

from checks.base import BaseCheck, CheckResult


class RegexCheck(BaseCheck):
    check_class = "regex_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            pattern = self.rule["pattern"]
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
                    details={"pattern": pattern, "error": f"Column '{field}' not found"},
                    error=f"Column '{field}' not found",
                )

            compiled = re.compile(pattern)
            values = df[field].astype(str).fillna("")

            # Null values count as failing
            null_mask = df[field].isna()
            match_mask = values.apply(lambda x: bool(compiled.match(x)))
            failing_mask = ~match_mask | null_mask

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
                details={"pattern": pattern, "sample_failing_values": [str(v) for v in failing_values]},
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
