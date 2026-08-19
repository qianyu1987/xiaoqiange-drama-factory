#!/usr/bin/env python3
"""Run local MLX Whisper with word timestamps and a configurable cache."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[3]
BUNDLED_FFMPEG_DIR = PACKAGE_ROOT / "tools" / "ffmpeg"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("media", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--output-name")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--language", default="zh")
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo")
    parser.add_argument("--cli", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    media = args.media.expanduser().resolve()
    if not media.is_file():
        raise SystemExit(f"Media not found: {media}")

    cli_value = args.cli or shutil.which("mlx_whisper") or os.environ.get("XQG_WHISPER_CLI")
    if not cli_value:
        raise SystemExit(
            "mlx_whisper is not installed. Put it on PATH or set XQG_WHISPER_CLI."
        )
    cli = Path(cli_value).expanduser().resolve()
    if not cli.is_file():
        raise SystemExit(
            f"mlx_whisper is not installed or is not a file: {cli}"
        )

    prompt = args.prompt
    if args.prompt_file:
        prompt = args.prompt_file.expanduser().read_text(encoding="utf-8").strip()

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_name = args.output_name or f"{media.stem}-word-timed"

    env = os.environ.copy()
    ffmpeg_dir_value = os.environ.get("OPENCHATCUT_FFMPEG_DIR") or os.environ.get("XQG_FFMPEG_DIR")
    ffmpeg_dir = Path(ffmpeg_dir_value).expanduser() if ffmpeg_dir_value else BUNDLED_FFMPEG_DIR
    if ffmpeg_dir.is_dir():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}{env.get('PATH', '')}"

    cache_value = os.environ.get("XQG_MODEL_CACHE")
    model_cache = Path(cache_value).expanduser() if cache_value else Path.home() / ".cache" / "xiaoqiange-drama-factory"
    model_cache.mkdir(parents=True, exist_ok=True)
    if os.access(model_cache, os.W_OK):
        env.setdefault("HF_HOME", str(model_cache / "huggingface"))
        env.setdefault("XDG_CACHE_HOME", str(model_cache))

    command = [
        str(cli),
        str(media),
        "--model",
        args.model,
        "--output-dir",
        str(output_dir),
        "--output-name",
        output_name,
        "--output-format",
        "all",
        "--language",
        args.language,
        "--word-timestamps",
        "True",
        "--condition-on-previous-text",
        "False",
    ]
    if prompt:
        command.extend(["--initial-prompt", prompt])

    completed = subprocess.run(command, env=env, check=False)
    if completed.returncode != 0:
        return completed.returncode

    expected = output_dir / f"{output_name}.json"
    if not expected.is_file():
        raise SystemExit(f"Whisper finished without creating {expected}")
    print(expected)
    return 0


if __name__ == "__main__":
    sys.exit(main())
