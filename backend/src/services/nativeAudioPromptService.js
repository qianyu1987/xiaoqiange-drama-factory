const SPOKEN_LABEL = /^\s*(?:旁白|解说|画外音|角色|speaker|narrator)\s*[：:]\s*/i;

function cleanSpokenText(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(SPOKEN_LABEL, '')
    .replace(/[\uFFFD]/g, '')
    .trim();
}

function parseDialogue(value) {
  const raw = String(value || '').normalize('NFC').trim();
  if (!raw) return { speaker: '', spokenText: '' };
  const match = raw.match(/^\s*([^：:\n]{1,20})[：:]\s*([\s\S]+)$/);
  if (!match || /^(?:旁白|解说|画外音)$/i.test(match[1].trim())) {
    return { speaker: '', spokenText: cleanSpokenText(raw) };
  }
  return { speaker: match[1].trim(), spokenText: cleanSpokenText(match[2]) };
}

function buildNativeAudioPrompt(input = {}) {
  const basePrompt = String(input.basePrompt || '').normalize('NFC').trim();
  const dialogue = parseDialogue(input.dialogue);
  const offscreenVoice = cleanSpokenText(input.offscreenVoice || input.narration);
  const bgmMotif = cleanSpokenText(input.bgmMotif || input.bgm);
  const soundEffects = cleanSpokenText(input.soundEffects || input.sound);

  if (dialogue.spokenText && offscreenVoice) {
    throw Object.assign(new Error('同一镜头不能同时包含人物对白和画外讲述'), { code: 'NATIVE_AUDIO_CONFLICT' });
  }

  const audio = [];
  if (dialogue.spokenText) {
    const speaker = dialogue.speaker || cleanSpokenText(input.speaker);
    if (!speaker) throw Object.assign(new Error('原声对白镜头缺少唯一说话人'), { code: 'SPEAKER_REQUIRED' });
    audio.push(`Only ${speaker} speaks in brisk, natural Mandarin Chinese at about 4 to 5 Chinese characters per second.`);
    audio.push(`The exact spoken sentence is: “${dialogue.spokenText}”`);
    audio.push(`${speaker}'s mouth and jaw articulate every syllable in sync; every other visible character stays silent with a closed mouth.`);
  } else if (offscreenVoice) {
    audio.push('An off-screen storyteller speaks in brisk, natural Mandarin Chinese. No visible character speaks or moves their mouth.');
    audio.push(`The exact spoken sentence is: “${offscreenVoice}”`);
  } else {
    audio.push('No spoken words. Every visible character remains silent with a closed mouth.');
  }

  if (bgmMotif) {
    audio.push(`Generate native background music in this exact recurring motif: ${bgmMotif}. Keep dialogue clearly audible and automatically duck the music while speech is present.`);
  }
  if (soundEffects) audio.push(`Generate native environmental and action sound: ${soundEffects}.`);
  audio.push('All dialogue, off-screen voice, ambience, sound effects, and music must be generated inside this video clip. Do not vocalize names, labels, field names, or production instructions.');
  audio.push('No subtitles, captions, text, letters, logos, watermarks, signs, labels, UI, or typographic elements anywhere in the image.');
  audio.push('Tight pacing: establish the beat within 2 seconds and introduce a visible action, reaction, camera, or story change every 2 to 3 seconds. No prolonged staring, drawn-out syllables, repeated action, or empty pause.');

  return [basePrompt, ...audio].filter(Boolean).join('\n');
}

module.exports = { cleanSpokenText, parseDialogue, buildNativeAudioPrompt };
