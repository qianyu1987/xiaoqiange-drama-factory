---
name: sync-short-drama-subtitles
description: Create speech-synchronized Chinese-English subtitles for short dramas and animation, with Chinese above English, compact bottom-safe styling, local Whisper word timestamps, paired SRT/ASS output, deterministic FFmpeg burn-in, and visual/technical QA. Use when the user asks for 配合对白的字幕, 中英双语字幕, 字幕对口型/语音, 剪映或 OpenChatCut 字幕, short-drama captions, subtitle timing repair, or the fixed 小钱哥短剧字幕规格.
---

# Sync Short-Drama Subtitles

Produce subtitles from actual speech timing. Never spread one cue across an
entire shot merely because the shot is 10 seconds long.

## Standard

- Put Chinese on the first line and English on the second line.
- Use compact white semibold/bold text with a black outline.
- Keep both lines centered in the bottom safe area.
- Show a cue only while its dialogue is audible.
- Keep identical cue boundaries and cue counts in both languages.
- Do not overlap adjacent cues. End the first at or before the next starts.
- Prefer 80-120 ms lead/hold padding around detected speech.
- Keep English concise and natural rather than literal and long.
- For 9:16 output, default to 42 px Chinese and 32 px English in a
  1080x1920 ASS reference canvas.

Read [references/spec.md](references/spec.md) for timing, generation, and QA
rules when producing a final deliverable.

## Workflow

1. Probe the source video before editing. Confirm duration, dimensions, frame
   rate, and audio presence.
2. Inspect several source frames for text already generated into the image.
   Baked-in text is not a subtitle track; report it and prefer regenerating the
   affected shot.
3. Obtain word timestamps with `scripts/transcribe_local.py`. When an approved
   script exists, pass it as `--prompt`; use ASR for timing and the approved
   script for wording.
4. Split merged ASR segments at authored sentence boundaries and meaningful
   pauses. Do not display captions over silent gaps.
5. Create paired UTF-8 SRT files. Match every start/end timestamp exactly.
6. Run `scripts/burn_bilingual.py` to validate, create ASS, render H.264/AAC,
   and probe the result.
7. Visually inspect frames inside each cue and at least two silent gaps.
   Confirm two lines, no overflow, no stale captions, and no four-line overlap.

## Local Transcription

```bash
python scripts/transcribe_local.py input.mp4 \
  --output-dir /Volumes/brainos/CodexMedia/generated/<task>/asr \
  --prompt-file approved-dialogue.txt
```

The script uses the local MLX Whisper installation. It stores reproducible
model caches on `/Volumes/brainos/MacStorage/Caches` when that volume is
available and does not upload media or consume API balance.

## Deterministic Render

```bash
python scripts/burn_bilingual.py \
  --video source.mp4 \
  --zh-srt captions-zh.srt \
  --en-srt captions-en.srt \
  --output final-bilingual.mp4
```

Use OpenChatCut for visual editing and timeline adjustments when useful. Keep
the paired SRT and ASS as the source of truth, and use deterministic FFmpeg
rendering as the export fallback.

## Completion Gate

Do not call the work complete until:

- word-level ASR or an equivalent timing source has been used;
- paired SRT timing validation passes;
- the output probes as playable H.264/AAC with the intended dimensions;
- dialogue and silent-gap frame checks pass;
- any source-generated text artifact is explicitly handled or reported.
