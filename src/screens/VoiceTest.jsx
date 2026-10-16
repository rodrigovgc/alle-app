import { useState } from 'react';
import { speak } from '../lib/speech.js';

/*
 * Test page at /voice-test (test site only): free Piper voices that run inside the browser,
 * next to the phone's own voice, so we can judge sound, download size and wait time on a
 * real phone before deciding anything. Piper loads only when a Piper button is tapped.
 */

const SETS = [
  {
    lang: 'it-IT', label: 'Italian',
    voices: [['it_IT-paola-medium', 'Paola (medium)'], ['it_IT-riccardo-x_low', 'Riccardo (small)']],
    phrases: ['Buongiorno, come stai?', 'Vorrei un caffè, per favore.', 'Dove si trova la stazione?'],
  },
  {
    lang: 'nl-NL', label: 'Dutch',
    voices: [['nl_NL-mls-medium', 'Netherlands (medium)'], ['nl_BE-nathalie-medium', 'Nathalie, Belgium (medium)']],
    phrases: ['Goedemorgen, hoe gaat het?', 'Ik wil graag een kopje koffie.', 'Waar is het station?'],
  },
  {
    lang: 'pt-BR', label: 'Portuguese',
    voices: [['pt_BR-faber-medium', 'Faber, Brazil (medium)'], ['pt_PT-tugão-medium', 'Tugão, Portugal (medium)']],
    phrases: ['Bom dia, tudo bem?', 'Qual é o motivo da sua viagem?', 'Eu vou ficar duas semanas.'],
  },
];

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

let piper; // loaded on first use
async function loadPiper() {
  piper ??= await import('@mintplex-labs/piper-tts-web');
  return piper;
}

function VoiceSet({ set }) {
  const [voice, setVoice] = useState(set.voices[0][0]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function playPiper(text) {
    if (busy) return;
    setBusy(true);
    const started = performance.now();
    try {
      const tts = await loadPiper();
      const had = (await tts.stored()).includes(voice);
      if (!had) setStatus('Downloading the voice…');
      const wav = await tts.predict({ text, voiceId: voice }, (p) => {
        if (p.total && /\.onnx$/.test(p.url)) setStatus(`Downloading the voice… ${mb(p.loaded)} of ${mb(p.total)}`);
      });
      const took = performance.now() - started;
      const audio = new Audio(URL.createObjectURL(wav));
      await audio.play();
      setStatus(had ? `Ready in ${secs(took)} (voice already saved on this device)` : `First play took ${secs(took)}, including the download. Next plays are faster.`);
    } catch (e) {
      setStatus(`Couldn’t play: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  async function forget() {
    const tts = await loadPiper();
    await tts.remove(voice);
    setStatus('Voice removed from this device. The next play downloads it again.');
  }

  return (
    <section className="voice-test__set">
      <h2>{set.label}</h2>
      <label className="voice-test__pick">
        Piper voice
        <select value={voice} onChange={(e) => { setVoice(e.target.value); setStatus(''); }}>
          {set.voices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {set.phrases.map((text) => (
        <div className="voice-test__row" key={text}>
          <p>{text}</p>
          <div className="voice-test__buttons">
            <button className="btn btn--primary" disabled={busy} onClick={() => playPiper(text)}>Piper</button>
            <button className="btn btn--secondary" onClick={() => speak(text, set.lang)}>Phone voice</button>
          </div>
        </div>
      ))}
      <p className="voice-test__status" aria-live="polite">{status}</p>
      <button className="text-btn text-btn--quiet" onClick={forget}>Remove this voice from my device</button>
    </section>
  );
}

export function VoiceTest() {
  return (
    <main className="voice-test">
      <h1>Voice test</h1>
      <p>Tap <b>Piper</b> and <b>Phone voice</b> on the same phrase to compare. The first Piper play downloads the voice once (about 30–75 MB, best on Wi-Fi); after that it’s saved on this device.</p>
      {SETS.map((s) => <VoiceSet key={s.lang} set={s} />)}
    </main>
  );
}
