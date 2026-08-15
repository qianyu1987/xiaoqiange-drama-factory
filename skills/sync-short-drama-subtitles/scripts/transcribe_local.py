#!/usr/bin/env python3
"""Run local MLX Whisper with word timestamps and external-disk caches."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


DEFAULT_CLI = Path("/Users/mac/.local/share/hhtc-subtitle-asr/bin/mlx_whisper")
OPENCHATCUT_FFMPEG_DIR = Path(
    "/Applications/OpenChatCut.app/Contents/Resources/app/node_modules/ffmpeg-static"
)


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

    cli = args.cli or (Path(shutil.which("mlx_whisper")) if shutil.which("mlx_whisper") else DEFAULT_CLI)
    if not cli.is_file():
        raise SystemExit(
            "mlx_whisper is not installed. Install mlx-whisper in the local ASR environment first."
        )

    prompt = args.prompt
    if args.prompt_file:
        prompt = args.prompt_file.expanduser().read_text(encoding="utf-8").strip()

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output_name = args.output_name or f"{media.stem}-word-timed"

    env = os.environ.copy()
    env["PATH"] = f"{OPENCHATCUT_FFMPEG_DIR}:{env.get('PATH', '')}"
    external_cache = Path("/Volumes/brainos/MacStorage/Caches")
    if external_cache.is_dir() and os.access(external_cache, os.W_OK):
        env.setdefault("HF_HOME", str(external_cache / "huggingface"))
        env.setdefault("XDG_CACHE_HOME", str(external_cache))

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
