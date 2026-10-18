"""
Data models for Plumber scanner.
"""
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional

CRITICAL = "CRITICAL"
HIGH = "HIGH"
MEDIUM = "MEDIUM"
LOW = "LOW"
INFO = "INFO"

ALL_SEVERITIES = [CRITICAL, HIGH, MEDIUM, LOW, INFO]

CAT_LEAKS = "Leaks & Secrets"
CAT_CLOGS = "Clogs & Dead Code"
CAT_SLOP = "AI Slop Tells"
CAT_PIPES = "Pipes & Dependencies"
CAT_JOINTS = "Joints & Accessibility"

ALL_CATEGORIES = [CAT_LEAKS, CAT_CLOGS, CAT_SLOP, CAT_PIPES, CAT_JOINTS]


@dataclass
class Issue:
    rule_id: str
    title: str
    severity: str
    category: str
    file_path: str
    line: int
    evidence: str = ""
    fix: str = ""
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class FileReport:
    path: str
    issues: List[Issue] = field(default_factory=list)
    line_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "line_count": self.line_count,
            "issues": [i.to_dict() for i in self.issues]
        }


@dataclass
class ScanReport:
    repo_name: str
    owner: str = ""
    commit: str = ""
    timestamp: str = ""
    total_files: int = 0
    total_lines: int = 0
    duration_seconds: float = 0.0
    score: float = 0.0
    grade: str = "A"
    issues: List[Issue] = field(default_factory=list)
    file_reports: List[FileReport] = field(default_factory=list)
    counts_by_severity: Dict[str, int] = field(default_factory=dict)
    counts_by_category: Dict[str, int] = field(default_factory=dict)
    brief: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "meta": {
                "project": f"{self.owner}/{self.repo_name}" if self.owner else self.repo_name,
                "owner": self.owner,
                "repo": self.repo_name,
                "commit": self.commit,
                "score": f"{self.score:.1f}",
                "grade": self.grade,
                "date": self.timestamp,
                "files": self.total_files,
                "lines": f"{self.total_lines:,}",
                "duration": f"{self.duration_seconds:.2f}s"
            },
            "counts": self.counts_by_severity,
            "categories": self.counts_by_category,
            "brief": self.brief,
            "files": [f.to_dict() for f in self.file_reports if f.issues]
        }
