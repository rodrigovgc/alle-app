import { alternatives } from './csv.js';

export const LANGUAGES = [
  { code: 'nl-NL', label: 'Dutch' },
  { code: 'en-US', label: 'English' },
  { code: 'fr-FR', label: 'French' },
  { code: 'de-DE', label: 'German' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' },
  { code: 'sv-SE', label: 'Swedish' },
  { code: 'da-DK', label: 'Danish' },
  { code: 'nb-NO', label: 'Norwegian' },
  { code: 'pl-PL', label: 'Polish' },
  { code: 'tr-TR', label: 'Turkish' },
  { code: 'el-GR', label: 'Greek' },
  { code: 'ru-RU', label: 'Russian' },
  { code: 'uk-UA', label: 'Ukrainian' },
  { code: 'ja-JP', label: 'Japanese' },
  { code: 'ko-KR', label: 'Korean' },
  { code: 'zh-CN', label: 'Chinese (Mandarin)' },
  { code: 'ar-SA', label: 'Arabic' },
  { code: 'hi-IN', label: 'Hindi' },
];

/** Guess the spoken language from the back-column header. Dutch → nl-NL, otherwise en-US. */
export function inferLang(label = '') {
  const l = label.toLowerCase();
  if (/dutch|nederlands|vlaams|flemish/.test(l)) return 'nl-NL';
  if (/portugu/.test(l)) return 'pt-BR';
  if (/fran|french/.test(l)) return 'fr-FR';
  if (/german|deutsch/.test(l)) return 'de-DE';
  if (/spanish|español|espanol/.test(l)) return 'es-ES';
  if (/ital/.test(l)) return 'it-IT';
  const more = [
    [/swed|svensk/, 'sv-SE'], [/danish|dansk/, 'da-DK'], [/norw|norsk/, 'nb-NO'], [/polish|polsk/, 'pl-PL'],
    [/turk/, 'tr-TR'], [/greek|ελλην/, 'el-GR'], [/russian|русск/, 'ru-RU'], [/ukrain/, 'uk-UA'],
    [/japan|日本/, 'ja-JP'], [/korean|한국/, 'ko-KR'], [/chinese|mandarin|中文/, 'zh-CN'], [/arabic|عرب/, 'ar-SA'], [/hindi/, 'hi-IN'],
  ].find(([re]) => re.test(l));
  return more ? more[1] : 'en-US';
}

// Built-in novelty and character voices (macOS) that exist in every language but sound robotic
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;
const norm = (code = '') => code.replace('_', '-').toLowerCase();

/** The best installed voice for a language: the exact region first, then natural-sounding ones. */
export function pickVoice(voices, lang) {
  const want = norm(lang);
  const base = want.split('-')[0];
  let best = null; let bestScore = -Infinity;
  for (const v of voices || []) {
    const vl = norm(v.lang);
    if (vl.split('-')[0] !== base) continue;                 // never a voice of another language
    let score = vl === want ? 4 : 0;
    if (/premium|enhanced|natural|neural|siri/i.test(v.name)) score += 5;
    if (/google/i.test(v.name)) score += 3;                   // Chrome's own voices are good
    if (NOVELTY.test(v.name)) score -= 6;
    if (v.localService === false) score += 1;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

// Chrome loads its voice list a moment after the page; ask early so it's ready by the first card
let voices = [];
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  const load = () => { voices = window.speechSynthesis.getVoices() || []; };
  load();
  window.speechSynthesis.addEventListener?.('voiceschanged', load);
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(backCell, lang = 'en-US') {
  if (!canSpeak()) return;
  const text = alternatives(backCell)[0].replace(/•/g, '. ');
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (!voices.length) voices = synth.getVoices() || [];
  const voice = pickVoice(voices, lang);
  if (voice) u.voice = voice; // none installed: the browser picks one for u.lang
  u.rate = 0.92;
  synth.speak(u);
}
