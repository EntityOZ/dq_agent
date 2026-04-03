import re

import pandas as pd

from checks.base import BaseCheck, CheckResult, find_id_field, safe_json


class RegexCheck(BaseCheck):
    check_class = "regex_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            pattern = self.rule["pattern"]
            total = len(df)

            if field not in df.columns:
                return None  # Skip — field not in partial extract

            compiled = re.compile(pattern)
            values = df[field].astype(str).fillna("")

            # Null values count as failing
            null_mask = df[field].isna()
            match_mask = values.apply(lambda x: bool(compiled.match(x)))
            failing_mask = ~match_mask | null_mask

            affected = int(failing_mask.sum())
            pass_rate = ((total - affected) / total * 100) if total > 0 else 0.0

            id_field = find_id_field(df)
            failing_rows = df[failing_mask]

            details = safe_json({
                "field_checked": field,
                "pattern": pattern,
                "id_field_used": id_field,
                "failing_record_count": int(failing_mask.sum()),
                "message": self.rule.get("message", ""),
                "sample_failing_records": [
                    {id_field: str(row[id_field]), field: str(row[field])}
                    for _, row in failing_rows.head(10).iterrows()
                ],
            })

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
                details=details,
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
