/*
 * Natural voices: free Piper voices that run inside the browser (no server, no cost).
 * A voice is a one-time download (~30–77 MB) saved on this device, so the choice is kept
 * per language on this device (localStorage), not on the deck: choosing Nathalie once
 * makes every Dutch deck on this phone use her, and nothing downloads on other devices.
 * Anything that goes wrong falls back to the phone's own voice.
 * Left out on purpose: voices whose licence is non-commercial or AGPL (ryan, tom, dfki,
 * kerstin, rapunzelina). Preview clips are Piper's own samples, hosted in /voice-samples.
 */

// id, display name, region, download size in MB (from the package's voice list)
const V = (id, name, region, mb) => ({ id, name, region, mb, sample: `/voice-samples/${id.replace('ã', 'a')}.mp3` });
const NATURAL = {
  en: [V('en_US-amy-medium', 'Amy', 'US', 63), V('en_GB-cori-medium', 'Cori', 'UK', 64), V('en_GB-alba-medium', 'Alba', 'Scotland', 63)],
  fr: [V('fr_FR-siwis-medium', 'Siwis', 'France', 63)],
  de: [V('de_DE-thorsten-medium', 'Thorsten', 'Germany', 63)],
  es: [V('es_ES-davefx-medium', 'Dave', 'Spain', 63), V('es_MX-claude-high', 'Claude', 'Mexico', 63)],
  it: [V('it_IT-paola-medium', 'Paola', 'Italy', 64), V('it_IT-riccardo-x_low', 'Riccardo', 'Italy', 28)],
  nl: [V('nl_BE-nathalie-medium', 'Nathalie', 'Belgium', 63), V('nl_BE-rdh-medium', 'Rdh', 'Belgium', 63)],
  pt: [V('pt_BR-faber-medium', 'Faber', 'Brazil', 63), V('pt_PT-tugão-medium', 'Tugão', 'Portugal', 63)],
  sv: [V('sv_SE-nst-medium', 'NST', 'Sweden', 63)],
  da: [V('da_DK-talesyntese-medium', 'Talesyntese', 'Denmark', 63)],
  nb: [V('no_NO-talesyntese-medium', 'Talesyntese', 'Norway', 63)],
  pl: [V('pl_PL-gosia-medium', 'Gosia', 'Poland', 63), V('pl_PL-darkman-medium', 'Darkman', 'Poland', 63)],
  ru: [V('ru_RU-irina-medium', 'Irina', 'Russia', 63), V('ru_RU-dmitri-medium', 'Dmitri', 'Russia', 63)],
  zh: [V('zh_CN-huayan-medium', 'Huayan', 'China', 63)],
  ar: [V('ar_JO-kareem-medium', 'Kareem', 'Jordan', 63)],
};
const REGION_OF = (id) => id.split('-')[0].split('_')[1]; // nl_BE-… → BE

/** Natural voices for a deck language, the deck's own region first (pt-PT → Tugão first). */
export function naturalVoices(lang = '') {
  const [base, region] = lang.split('-');
  const list = NATURAL[base] || [];
  return [...list].sort((a, b) => (REGION_OF(b.id) === region) - (REGION_OF(a.id) === region));
}

// ---- What this device chose, and what it has downloaded

const CHOICE = 'alle-voice:';
const READY = 'alle-voices-ready';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const readySet = () => new Set(JSON.parse(store.get(READY) || '[]'));
function markReady(id, yes) {
  const s = readySet(); yes ? s.add(id) : s.delete(id);
  store.set(READY, JSON.stringify([...s]));
}

/** 'phone' or a natural voice id, for this language on this device. */
export function voiceChoice(lang) {
  const id = store.get(CHOICE + lang);
  return id && naturalVoices(lang).some((v) => v.id === id) ? id : 'phone';
}
export function setVoiceChoice(lang, id) { store.set(CHOICE + lang, id); emit(); }
export const isReady = (id) => readySet().has(id);

// ---- Download progress, shared so the settings sheet can close and reopen

const progress = new Map(); // id → { loaded, total } while downloading, { error } if it failed
const listeners = new Set();
function emit() { listeners.forEach((fn) => fn()); }
export function onVoicesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const downloadState = (id) => progress.get(id);

let piper;
const loadPiper = async () => (piper ??= await import('@mintplex-labs/piper-tts-web'));

export async function downloadVoice(id) {
  const cur = progress.get(id);
  if (cur && !cur.error) return; // already downloading
  progress.set(id, { loaded: 0, total: 0 }); emit();
  try {
    const tts = await loadPiper();
    await tts.download(id, (p) => {
      if (/\.onnx$/.test(p.url) && p.total) { progress.set(id, { loaded: p.loaded, total: p.total }); emit(); }
    });
    progress.delete(id); markReady(id, true); emit();
  } catch (e) {
    progress.set(id, { error: true }); emit();
  }
}

export async function removeVoice(id) {
  const tts = await loadPiper();
  await tts.remove(id).catch(() => {});
  markReady(id, false); emit();
}

// ---- Speaking

async function session(id) {
  const tts = await loadPiper();
  // The package keeps the first voice it loaded and only swaps the name: start fresh for another voice
  if (tts.TtsSession._instance && tts.TtsSession._instance.voiceId !== id) tts.TtsSession._instance = null;
  return tts.TtsSession.create({ voiceId: id });
}

/** Load the voice ahead of the first tap (the first sentence otherwise waits a second or two). */
export function warmVoice(lang) {
  const id = voiceChoice(lang);
  if (id !== 'phone' && isReady(id)) session(id).catch(() => {});
}

const clips = new Map(); // `${id}|${text}` → object URL, so repeats play at once
const audio = typeof Audio !== 'undefined' ? new Audio() : null;
export function stopNatural() { audio?.pause(); }

/** Plays text in a downloaded natural voice. Rejects if it can't, so the caller can use the phone voice. */
export async function speakNatural(text, id) {
  const key = `${id}|${text}`;
  let url = clips.get(key);
  if (!url) {
    const tts = await loadPiper();
    if (!(await tts.stored()).includes(id)) { markReady(id, false); throw new Error('voice not on this device'); }
    const s = await session(id);
    url = URL.createObjectURL(await s.predict(text));
    if (clips.size > 60) { const [k, u] = clips.entries().next().value; URL.revokeObjectURL(u); clips.delete(k); }
    clips.set(key, url);
  }
  audio.pause();
  audio.src = url;
  audio.playbackRate = 0.95;
  await audio.play();
}

/** Short preview clip of a voice, without downloading it. */
export function previewVoice(v) {
  if (!audio) return;
  audio.pause();
  audio.src = v.sample;
  audio.playbackRate = 1;
  audio.play().catch(() => {});
}
