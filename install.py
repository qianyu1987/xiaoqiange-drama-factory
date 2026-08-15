#!/usr/bin/env python3
"""Install the bundled Codex skill into the current user's skill directory."""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil


SKILL_NAME = "sync-short-drama-subtitles"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target",
        type=Path,
        default=Path.home() / ".codex" / "skills",
        help="Codex skills directory",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    source = Path(__file__).resolve().parent / "skills" / SKILL_NAME
    target = args.target.expanduser().resolve() / SKILL_NAME
    if not source.joinpath("SKILL.md").is_file():
        raise SystemExit(f"Missing bundled skill: {source}")
    if target.exists():
        if not args.force:
            raise SystemExit(f"Already installed: {target}. Use --force to replace it.")
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    print(f"Installed {SKILL_NAME} to {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
