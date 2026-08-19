#!/usr/bin/env python3
"""Validate paired SRT files, generate styled ASS, and render an MP4."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[3]
BUNDLED_FFMPEG_DIR = PACKAGE_ROOT / "tools" / "ffmpeg"
BUNDLED_FFMPEG = BUNDLED_FFMPEG_DIR / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
BUNDLED_FFPROBE = BUNDLED_FFMPEG_DIR / ("ffprobe.exe" if os.name == "nt" else "ffprobe")
TIMESTAMP = re.compile(
    r"^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s+-->\s+"
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--zh-srt", required=True, type=Path)
    parser.add_argument("--en-srt", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--ass-output", type=Path)
    parser.add_argument("--ffmpeg", type=Path)
    parser.add_argument("--ffprobe", type=Path)
    parser.add_argument("--zh-size", type=int, default=42)
    parser.add_argument("--en-size", type=int, default=32)
    parser.add_argument("--crf", type=int, default=18)
    return parser.parse_args()


def to_ms(parts: tuple[str, ...]) -> int:
    hours, minutes, seconds, millis = map(int, parts)
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def parse_srt(path: Path) -> list[dict[str, object]]:
    blocks = re.split(r"\n\s*\n", path.read_text(encoding="utf-8-sig").strip())
    cues: list[dict[str, object]] = []
    for block in blocks:
        lines = [line.rstrip() for line in block.splitlines()]
        if len(lines) < 3:
            raise ValueError(f"Malformed SRT block in {path}: {block!r}")
        match = TIMESTAMP.match(lines[1].strip())
        if not match:
            raise ValueError(f"Invalid timestamp in {path}: {lines[1]!r}")
        start = to_ms(match.groups()[:4])
        end = to_ms(match.groups()[4:])
        text = " ".join(line.strip() for line in lines[2:] if line.strip())
        if end <= start or not text:
            raise ValueError(f"Invalid cue in {path}: {block!r}")
        cues.append({"start": start, "end": end, "text": text})

    for previous, current in zip(cues, cues[1:]):
        if int(previous["end"]) > int(current["start"]):
            raise ValueError(f"Overlapping cues in {path}: {previous} / {current}")
    return cues


def ass_time(milliseconds: int) -> str:
    centiseconds = round(milliseconds / 10)
    seconds, cs = divmod(centiseconds, 100)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f"{hours}:{minute:02d}:{sec:02d}.{cs:02d}"


def ass_text(value: str) -> str:
    return value.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def find_binary(explicit: Path | None, name: str, fallback: Path, env_name: str) -> Path:
    if explicit:
        result = explicit.expanduser().resolve()
    elif os.environ.get(env_name):
        result = Path(os.environ[env_name]).expanduser().resolve()
    elif shutil.which(name):
        result = Path(shutil.which(name) or "")
    else:
        result = fallback
    if not result.is_file():
        raise SystemExit(f"{name} not found: {result}")
    return result


def write_ass(path: Path, zh: list[dict[str, object]], en: list[dict[str, object]], args: argparse.Namespace) -> None:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Chinese,PingFang SC,{args.zh_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,80,80,158,1
Style: English,Arial,{args.en_size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,80,80,105,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    for zh_cue, en_cue in zip(zh, en):
        start = ass_time(int(zh_cue["start"]))
        end = ass_time(int(zh_cue["end"]))
        events.append(f"Dialogue: 0,{start},{end},Chinese,,0,0,0,,{ass_text(str(zh_cue['text']))}")
        events.append(f"Dialogue: 0,{start},{end},English,,0,0,0,,{ass_text(str(en_cue['text']))}")
    path.write_text(header + "\n".join(events) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    video = args.video.expanduser().resolve()
    zh_path = args.zh_srt.expanduser().resolve()
    en_path = args.en_srt.expanduser().resolve()
    output = args.output.expanduser().resolve()
    for path in (video, zh_path, en_path):
        if not path.is_file():
            raise SystemExit(f"Input not found: {path}")

    zh = parse_srt(zh_path)
    en = parse_srt(en_path)
    if len(zh) != len(en):
        raise SystemExit(f"Cue count mismatch: Chinese={len(zh)}, English={len(en)}")
    for index, (zh_cue, en_cue) in enumerate(zip(zh, en), start=1):
        if (zh_cue["start"], zh_cue["end"]) != (en_cue["start"], en_cue["end"]):
            raise SystemExit(f"Cue {index} timing mismatch")

    ffmpeg = find_binary(args.ffmpeg, "ffmpeg", BUNDLED_FFMPEG, "XQG_FFMPEG_PATH")
    ffprobe = find_binary(args.ffprobe, "ffprobe", BUNDLED_FFPROBE, "XQG_FFPROBE_PATH")
    output.parent.mkdir(parents=True, exist_ok=True)
    ass_path = (args.ass_output or output.with_suffix(".ass")).expanduser().resolve()
    write_ass(ass_path, zh, en, args)

    filter_path = str(ass_path).replace("\\", r"\\").replace(":", r"\:").replace("'", r"\'")
    command = [
        str(ffmpeg), "-y", "-i", str(video), "-vf", f"ass={filter_path}",
        "-c:v", "libx264", "-preset", "fast", "-crf", str(args.crf),
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
        "-ar", "48000", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(command, check=True)

    probe = subprocess.run(
        [str(ffprobe), "-v", "error", "-show_entries", "format=duration,size",
         "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt,r_frame_rate,sample_rate,channels",
         "-of", "json", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    report = {"output": str(output), "ass": str(ass_path), "cues": len(zh), "probe": json.loads(probe.stdout)}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
