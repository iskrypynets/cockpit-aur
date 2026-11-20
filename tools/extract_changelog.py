#!/usr/bin/env python3
"""
Extract release notes for a specific version from CHANGELOG.md.
Usage:
    python3 tools/extract_changelog.py [VERSION_OR_TAG] [--file PATH]
Example:
    python3 tools/extract_changelog.py v0.5.3
    python3 tools/extract_changelog.py 0.5.3 --output release_notes.md
"""
import argparse
import re
import sys
from pathlib import Path

def extract_changelog(version: str | None = None, changelog_path: Path = Path("CHANGELOG.md")) -> str:
    if not changelog_path.exists():
        sys.stderr.write(f"Error: {changelog_path} not found.\n")
        return ""

    content = changelog_path.read_text(encoding="utf-8")

    if version:
        clean_version = version.lstrip("v").strip()
        pattern = rf"## \[{re.escape(clean_version)}\][^\n]*\n(.*?)(?=\n## \[|\Z)"
    else:
        # Default to first version entry
        pattern = r"## \[[^\]]+\][^\n]*\n(.*?)(?=\n## \[|\Z)"

    match = re.search(pattern, content, re.DOTALL)
    if not match:
        sys.stderr.write(f"Warning: No changelog section found for version '{version}'.\n")
        return ""

    return match.group(1).strip()

def main():
    parser = argparse.ArgumentParser(description="Extract release notes from CHANGELOG.md")
    parser.add_argument("version", nargs="?", default=None, help="Version or tag (e.g. 0.5.3 or v0.5.3)")
    parser.add_argument("--file", default="CHANGELOG.md", help="Path to CHANGELOG.md")
    parser.add_argument("--output", "-o", default=None, help="Output file path (default stdout)")

    args = parser.parse_args()
    notes = extract_changelog(args.version, Path(args.file))

    if args.output:
        Path(args.output).write_text(notes + "\n", encoding="utf-8")
        print(f"Release notes written to {args.output}")
    else:
        print(notes)

if __name__ == "__main__":
    main()
