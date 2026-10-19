"""
GitHub tarball streamer and safe sandbox extractor.
"""
import io
import re
import shutil
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from typing import Tuple, Optional, Dict, List

from plumber.core.models import ScanReport
from plumber.core.engine import PlumberEngine, SKIP_DIRS, SCANNABLE_EXTS

MAX_DOWNLOAD = 60 * 1024 * 1024       # 60MB compressed
MAX_EXTRACTED = 250 * 1024 * 1024     # 250MB extracted
MAX_FILES = 25_000
MAX_SINGLE_FILE = 2 * 1024 * 1024     # 2MB
DOWNLOAD_TIMEOUT = 25

OWNER_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")
REPO_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
URL_RE = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/([^/\s]+)/([^/\s#?]+)", re.IGNORECASE)

# In-memory cache for warm responses: (owner, repo) -> (timestamp, ScanReport)
_SCAN_CACHE: Dict[Tuple[str, str], Tuple[float, ScanReport]] = {}
CACHE_TTL = 600  # 10 minutes


class FetchError(Exception):
    def __init__(self, status: int, message: str, hint: str = ""):
        super().__init__(message)
        self.status = status
        self.message = message
        self.hint = hint


def parse_repo_slug(text: str) -> Tuple[str, str]:
    """Parses 'owner/repo' or full GitHub URL into (owner, repo)."""
    text = (text or "").strip()
    match = URL_RE.match(text)
    if match:
        owner, repo = match.groups()
    else:
        parts = text.split("/")
        owner = parts[0] if len(parts) > 0 else ""
        repo = parts[1] if len(parts) > 1 else ""

    if repo.lower().endswith(".git"):
        repo = repo[:-4]

    if not (OWNER_RE.match(owner) and REPO_RE.match(repo)) or repo in (".", ".."):
        raise FetchError(
            400,
            "Invalid GitHub repository format.",
            "Please provide 'owner/repo' or a full URL like 'https://github.com/owner/repo'."
        )
    return owner, repo


def download_tarball(owner: str, repo: str) -> bytes:
    """Streams default branch as .tar.gz directly from GitHub codeload CDN."""
    url = f"https://codeload.github.com/{quote(owner, safe='')}/{quote(repo, safe='')}/tar.gz/HEAD"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Plumber-Scanner/1.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT) as resp:
            data = resp.read(MAX_DOWNLOAD + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise FetchError(
                404,
                f"Repository '{owner}/{repo}' not found.",
                "Ensure the repository is public and spelled correctly."
            ) from e
        raise FetchError(
            502,
            f"GitHub returned HTTP {e.code}.",
            "Please try again shortly."
        ) from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise FetchError(
            504,
            "GitHub download timed out.",
            "Large repositories are best inspected using Plumber CLI locally."
        ) from e

    if len(data) > MAX_DOWNLOAD:
        raise FetchError(
            413,
            "Repository archive exceeds 60MB limit.",
            "Run Plumber CLI locally to inspect large codebases."
        )

    return data


def extract_tarball_in_memory(archive: bytes) -> Tuple[str, List[Tuple[str, str]]]:
    """Extracts scannable files from tarball directly in memory without disk writes."""
    files_count = 0
    total_bytes = 0
    file_items: List[Tuple[str, str]] = []

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue

            parts = PurePosixPath(member.name).parts[1:]  # Drop root folder
            if not parts or any(p in ("..", "") or p.startswith("/") or ":" in p for p in parts):
                continue
            if any(p in SKIP_DIRS for p in parts[:-1]):
                continue

            filename = parts[-1]
            ext = Path(filename).suffix.lower()
            if filename.startswith(".env"):
                ext = ".env"

            if ext not in SCANNABLE_EXTS and not filename.startswith(".env"):
                continue

            files_count += 1
            if files_count > MAX_FILES:
                raise FetchError(
                    413,
                    "Repository exceeds 25,000 files limit.",
                    "Run Plumber locally to scan very large repositories."
                )

            if member.size > MAX_SINGLE_FILE:
                continue

            source = tar.extractfile(member)
            if not source:
                continue
            chunk = source.read()
            total_bytes += len(chunk)
            if total_bytes > MAX_EXTRACTED:
                raise FetchError(
                    413,
                    "Extracted contents exceed 250MB limit.",
                    "Run Plumber locally for huge projects."
                )

            try:
                content = chunk.decode("utf-8", errors="ignore")
                rel_path = "/".join(parts)
                file_items.append((rel_path, content))
            except Exception:
                continue

        commit = str(tar.pax_headers.get("comment", "")) if hasattr(tar, "pax_headers") else ""

    commit_sha = commit[:40] if re.fullmatch(r"[0-9a-f]{40}", commit) else ""
    return commit_sha, file_items


def extract_tarball_safely(archive: bytes, dest: Path) -> str:
    """Safely unpacks tarball enforcing sandbox, file limits, and traversal protection to disk."""
    files_count = 0
    written_bytes = 0

    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue

            parts = PurePosixPath(member.name).parts[1:]  # Drop root folder
            if not parts or any(p in ("..", "") or p.startswith("/") or ":" in p for p in parts):
                continue
            if any(p in SKIP_DIRS for p in parts[:-1]):
                continue

            files_count += 1
            if files_count > MAX_FILES:
                raise FetchError(
                    413,
                    "Repository exceeds 25,000 files limit.",
                    "Run Plumber locally to scan very large repositories."
                )

            target = dest.joinpath(*parts)
            target.parent.mkdir(parents=True, exist_ok=True)

            if member.size > MAX_SINGLE_FILE:
                target.touch()
                continue

            source = tar.extractfile(member)
            chunk = source.read() if source else b""
            written_bytes += len(chunk)
            if written_bytes > MAX_EXTRACTED:
                raise FetchError(
                    413,
                    "Extracted contents exceed 250MB limit.",
                    "Run Plumber locally for huge projects."
                )
            target.write_bytes(chunk)

        commit = str(tar.pax_headers.get("comment", "")) if hasattr(tar, "pax_headers") else ""

    return commit[:40] if re.fullmatch(r"[0-9a-f]{40}", commit) else ""


def scan_github_repo(owner: str, repo: str) -> ScanReport:
    """End-to-end download, in-memory stream extraction, inspection, and cleanup."""
    cache_key = (owner.lower(), repo.lower())
    now = time.monotonic()
    if cache_key in _SCAN_CACHE:
        ts, cached_rep = _SCAN_CACHE[cache_key]
        if now - ts < CACHE_TTL:
            return cached_rep

    archive = download_tarball(owner, repo)
    commit, file_items = extract_tarball_in_memory(archive)
    del archive  # Release memory

    engine = PlumberEngine()
    report = engine.scan_files(file_items, repo_name=repo, owner=owner, commit=commit)
    _SCAN_CACHE[cache_key] = (now, report)
    return report
