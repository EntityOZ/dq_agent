from abc import ABC, abstractmethod
from typing import Optional

import pandas as pd
from pydantic import BaseModel


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


class BaseCheck(ABC):
    check_class: str = ""

    def __init__(self, rule: dict):
        self.rule = rule

    @abstractmethod
    def run(self, df: pd.DataFrame) -> CheckResult:
        ...
