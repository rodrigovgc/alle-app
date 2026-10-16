import { useEffect, useReducer } from 'react';
import { Icon } from './Icon.jsx';
import { LANGUAGES, speakPhone } from '../lib/speech.js';
import {
  naturalVoices, voiceChoice, setVoiceChoice, isReady, downloadVoice, removeVoice,
  downloadState, onVoicesChange, previewVoice,
} from '../lib/voices.js';
import { track } from '../lib/analytics.js';

// A short line for previewing the phone's own voice
const HELLO = {
  en: 'Hello, how are you today?', fr: 'Bonjour, comment ça va ?', de: 'Hallo, wie geht es dir?',
  es: 'Hola, ¿qué tal estás?', it: 'Ciao, come stai oggi?', nl: 'Hallo, hoe gaat het vandaag?',
  pt: 'Olá, tudo bem com você?', sv: 'Hej, hur mår du idag?', da: 'Hej, hvordan har du det?',
  nb: 'Hei, hvordan har du det?', pl: 'Cześć, jak się masz?', ru: 'Привет, как дела?',
  zh: '你好，你今天好吗？', ar: 'مرحبا، كيف حالك؟',
};

const mb = (n) => Math.round(n / 1e6);

/** "Voice" choice under the deck's read-aloud language. Only shown when a natural voice exists. */
export function VoicePicker({ lang }) {
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => onVoicesChange(refresh), []);
  const voices = naturalVoices(lang);
  if (!voices.length) return null;

  const chosen = voiceChoice(lang);
  const langName = LANGUAGES.find((l) => l.code === lang)?.label.replace(/ \(.*\)/, '') || 'this language';

  function choose(id) {
    setVoiceChoice(lang, id);
    if (id !== 'phone') {
      track('voice_natural_chosen', { voice: id });
      if (!isReady(id)) downloadVoice(id);
    }
  }

  function status(v) {
    const d = downloadState(v.id);
    if (d?.error) return <span className="voice-pick__inline">Download stopped · <button type="button" className="text-btn" onClick={() => downloadVoice(v.id)}>Try again</button></span>;
    if (d) {
      return (
        <>
          <span>{d.total ? `Downloading… ${mb(d.loaded)} of ${mb(d.total)} MB` : 'Starting download…'}</span>
          <span className="voice-pick__bar"><span style={{ width: d.total ? `${(100 * d.loaded) / d.total}%` : '2%' }} /></span>
        </>
      );
    }
    if (isReady(v.id)) return 'Natural · saved on this device';
    return `Natural · ${v.mb} MB download`;
  }

  const rows = [{ id: 'phone', name: 'Phone voice', note: 'Built into this device' }, ...voices];

  return (
    <div className="builder__group voice-pick">
      <span className="field__label" id="voice-label">Voice</span>
      <div role="radiogroup" aria-labelledby="voice-label" className="voice-pick__list">
        {rows.map((v) => {
          const on = chosen === v.id;
          return (
            <div key={v.id} className={`voice-pick__row ${on ? 'is-on' : ''}`}>
              <button type="button" role="radio" aria-checked={on} className="voice-pick__choose" onClick={() => choose(v.id)}>
                <span className="voice-pick__dot" aria-hidden="true">{on && <Icon name="check" />}</span>
                <span className="voice-pick__text">
                  <span className="voice-pick__name">{v.id === 'phone' ? v.name : `${v.name} · ${v.region}`}</span>
                  <span className="voice-pick__note">{v.id === 'phone' ? v.note : status(v)}</span>
                </span>
              </button>
              <button
                type="button"
                className="icon-btn voice-pick__play"
                aria-label={`Hear ${v.name}`}
                onClick={() => (v.id === 'phone' ? speakPhone(HELLO[lang.split('-')[0]] || 'Hello', lang) : previewVoice(v))}
              >
                <Icon name="speaker" />
              </button>
            </div>
          );
        })}
      </div>
      <span className="field__hint">
        Used for every {langName} deck on this device. Natural voices download once, best on Wi-Fi.
        {chosen !== 'phone' && isReady(chosen) && (
          <> <button type="button" className="text-btn text-btn--quiet" onClick={() => { removeVoice(chosen); setVoiceChoice(lang, 'phone'); }}>Remove download</button></>
        )}
      </span>
    </div>
  );
}
