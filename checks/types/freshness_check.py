from datetime import datetime, timezone

import pandas as pd

from checks.base import BaseCheck, CheckResult


class FreshnessCheck(BaseCheck):
    check_class = "freshness_check"

    def run(self, df: pd.DataFrame) -> CheckResult:
        try:
            field = self.rule["field"]
            max_age_hours = self.rule["max_age_hours"]
            total = len(df)

            if field not in df.columns:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "timeliness"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={"max_age_hours": max_age_hours, "error": f"Column '{field}' not found"},
                    error=f"Column '{field}' not found",
                )

            now = datetime.now(timezone.utc)

            try:
                parsed = pd.to_datetime(df[field], errors="coerce", utc=True)
            except Exception:
                return CheckResult(
                    check_id=self.rule["id"],
                    module=self.rule.get("module", ""),
                    field=field,
                    severity=self.rule.get("severity", "medium"),
                    dimension=self.rule.get("dimension", "timeliness"),
                    passed=False,
                    affected_count=total,
                    total_count=total,
                    pass_rate=0.0,
                    message=self.rule.get("message", ""),
                    details={
                        "max_age_hours": max_age_hours,
                        "parse_error": "Could not parse column as datetime",
                    },
                    error="Could not parse column as datetime",
                )

            # NaT (unparseable) values count as failing
            nat_mask = parsed.isna()
            cutoff = now - pd.Timedelta(hours=max_age_hours)
            stale_mask = parsed < cutoff
            failing_mask = nat_mask | stale_mask

            affected = int(failing_mask.sum())
            pass_rate = ((total - affected) / total * 100) if total > 0 else 0.0

            valid_dates = parsed.dropna()
            oldest = str(valid_dates.min()) if len(valid_dates) > 0 else "N/A"
            newest = str(valid_dates.max()) if len(valid_dates) > 0 else "N/A"

            return CheckResult(
                check_id=self.rule["id"],
                module=self.rule.get("module", ""),
                field=field,
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "timeliness"),
                passed=(affected == 0),
                affected_count=affected,
                total_count=total,
                pass_rate=round(pass_rate, 2),
                message=self.rule.get("message", ""),
                details={
                    "max_age_hours": max_age_hours,
                    "oldest_value": oldest,
                    "newest_value": newest,
                },
            )
        except Exception as e:
            return CheckResult(
                check_id=self.rule.get("id", "UNKNOWN"),
                module=self.rule.get("module", ""),
                field=self.rule.get("field", ""),
                severity=self.rule.get("severity", "medium"),
                dimension=self.rule.get("dimension", "timeliness"),
                passed=False,
                affected_count=0,
                total_count=len(df),
                pass_rate=0.0,
                message=self.rule.get("message", ""),
                details={},
                error=str(e),
            )
