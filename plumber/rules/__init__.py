"""
Rule base classes and registry for Plumber.
"""
from dataclasses import dataclass
from typing import List, Callable, Optional, Dict
from pathlib import Path
from plumber.core.models import Issue


@dataclass
class FileContext:
    path: str
    filename: str
    ext: str
    content: str
    lines: List[str]
    is_test: bool
    is_markup: bool
    is_style: bool
    is_script: bool
    is_doc: bool


class Rule:
    def __init__(
        self,
        rule_id: str,
        title: str,
        severity: str,
        category: str,
        description: str,
        fix: str,
        checker: Callable[[FileContext], List[Issue]]
    ):
        self.rule_id = rule_id
        self.title = title
        self.severity = severity
        self.category = category
        self.description = description
        self.fix = fix
        self.checker = checker

    def check(self, ctx: FileContext) -> List[Issue]:
        try:
            return self.checker(ctx)
        except Exception:
            return []


ALL_RULES: List[Rule] = []


def register_rule(rule_id: str, title: str, severity: str, category: str, description: str, fix: str):
    def decorator(fn: Callable[[FileContext], List[Issue]]):
        r = Rule(rule_id, title, severity, category, description, fix, fn)
        ALL_RULES.append(r)
        return fn
    return decorator


def load_all_rules():
    """Ensure all rule modules are imported and registered."""
    from plumber.rules import leaks, clogs, slop, pipes, joints  # noqa: F401
    return ALL_RULES
