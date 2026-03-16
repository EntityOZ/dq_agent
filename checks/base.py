from abc import ABC, abstractmethod
from typing import Any, Optional

import pandas as pd
from pydantic import BaseModel

# SAP key field name fragments — used to find the best identifier column
SAP_KEY_FRAGMENTS = [
    "PARTNER", "MATNR", "SAKNR", "KUNNR", "LIFNR", "EQUNR", "AUFNR",
    "ID", "NUMBER", "CODE", "KEY",
]


def safe_json(obj: Any) -> Any:
    """Recursively convert a dict/list to JSON-safe Python types."""
    if isinstance(obj, dict):
        return {k: safe_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_json(v) for v in obj]
    if hasattr(obj, "item"):  # numpy scalar
        return obj.item()
    if hasattr(obj, "isoformat"):  # datetime / Timestamp
        return obj.isoformat()
    if obj != obj:  # NaN check
        return None
    return obj


def find_id_field(df: pd.DataFrame) -> str:
    """Find the best identifier column in a DataFrame — prefer SAP key fields."""
    for col in df.columns:
        upper = col.upper()
        if any(key in upper for key in SAP_KEY_FRAGMENTS):
            return col
    return df.columns[0]


class CheckResult(BaseModel):
    check_id: str
    module: str
    field: str
    severity: str  # critical | high | medium | low
    dimension: str  # completeness | accuracy | consistency | timeliness | uniqueness | validity
    passed: bool
    affected_count: int
    total_count: int
    pass_rate: float  # 0.0 to 100.0
    message: str
    details: dict
    error: Optional[str] = None
    rule_context: Optional[dict] = None
    value_fix_map: Optional[dict] = None
    record_fixes: Optional[list] = None


class BaseCheck(ABC):
    check_class: str = ""

    def __init__(self, rule: dict):
        self.rule = rule

    @abstractmethod
    def run(self, df: pd.DataFrame) -> CheckResult:
        ...
