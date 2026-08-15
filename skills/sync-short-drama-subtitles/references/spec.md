# Subtitle Production Specification

## Source generation

Add this constraint to every image/video generation prompt:

> No subtitles, captions, text, letters, logos, watermarks, signs, labels, UI,
> or typographic elements anywhere in the image. Dialogue is spoken audio only.

If a model still generates visible text, regenerate the shot. Do not pretend a
new subtitle layer can remove text baked into the pixels. A localized mask or
opaque caption panel is a last-resort repair and must be reported.

## Timing

- Treat word timestamps as evidence, not ASR wording as final copy.
- Preserve the approved dialogue text when one exists.
- Split a cue at sentence boundaries, speaker changes, and pauses around
  250 ms or longer.
- Aim for 1.0-5.5 seconds per cue. Short exclamations may be shorter when the
  delivery is fast.
- Apply about 100 ms lead and 100 ms hold without crossing another cue.
- Never leave a cue visible through a multi-second silent/action-only section.
- Chinese and English cue boundaries must match exactly.

## Copy

- Chinese: use approved dialogue and normalized punctuation.
- English: translate meaning and dramatic intent; shorten where necessary.
- Keep one Chinese line and one English line whenever possible.
- Avoid untranslated names unless they are intentional character names.

## Style

- Reference canvas: 1080x1920, scaled proportionally by libass.
- Chinese: PingFang SC or Noto Sans SC, 42 px, bold, 3 px black outline.
- English: Arial or Noto Sans, 32 px, semibold/bold, 2 px black outline.
- Alignment: bottom center.
- Chinese lower margin: 158 px; English lower margin: 105 px.
- Maximum two active subtitle lines. Adjacent cue overlap is forbidden.

## QA sampling

Extract and inspect frames at:

1. 200-500 ms after every cue starts.
2. The middle of each long cue.
3. At least two known silent gaps.
4. The first and last second of the video.

Reject when subtitles overflow, cover faces or critical action, remain during
silence, mismatch the spoken sentence, stack into four lines, or conflict with
baked-in source text.
