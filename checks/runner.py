import logging
from pathlib import Path

import pandas as pd
import yaml

from checks.base import BaseCheck, CheckResult
from checks.types.null_check import NullCheck
from checks.types.regex_check import RegexCheck
from checks.types.domain_value_check import DomainValueCheck
from checks.types.cross_field_check import CrossFieldCheck
from checks.types.referential_check import ReferentialCheck
from checks.types.freshness_check import FreshnessCheck

logger = logging.getLogger("vantax.checks")

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
    return results
