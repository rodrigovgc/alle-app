import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';
import { AutoInput } from './AutoInput.jsx';
import { Field, SheetActions } from './Sheet.jsx';
import { Segmented } from './Segmented.jsx';
import { DeckImportError, parseLooseTable } from '../lib/csv.js';
import { inferLang } from '../lib/speech.js';
import { track } from '../lib/analytics.js';
import { imageSrc, needsFrame } from '../lib/media.js';
import { aiAllowance, generateCards, retryCard } from '../lib/aiDeck.js';
import {
  LEVELS, SIZES, SUBJECTS, buildPrompt, describeTopic, presetFor,
} from '../lib/prompt.js';

const STEPS = ['subject', 'topic', 'sides', 'size', 'finish'];
const LANGS = ['Dutch', 'French', 'Spanish', 'Portuguese', 'German', 'Italian'];
const TOPIC_HINTS = {
  science: 'e.g. Cell biology',
  history: 'e.g. The French Revolution',
  math: 'e.g. Multiplication tables',
  other: 'e.g. Wine regions of Portugal',
};
// A real example for the front/back step ("thank you" in the language being learned).
const THANK_YOU = { dutch: 'dank je', french: 'merci', spanish: 'gracias', portuguese: 'obrigado', german: 'danke', italian: 'grazie' };

/** What the deck will be called unless the person renames it. */
export function defaultDeckName(v) {
  if (v.subject === 'language') return v.learning.trim() || 'New language';
  if (v.topic?.trim()) return v.topic.trim();
  return SUBJECTS.find((s) => s.id === v.subject)?.label ?? 'New deck';
}

/**
 * Five short steps: subject → topic → front & back → size → finish.
 * The finish step has everything in one place: an overview, the prompt to copy
 * (or open straight in an AI chat), and the box to paste the reply into.
 * The prompt is a fixed template filled in the browser, so it costs nothing.
 */
export function AiBuilder({ onCreate, pasteOnly = false }) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(pasteOnly ? STEPS.indexOf('finish') : 0);
  const [dir, setDir] = useState(1);
  const [v, setV] = useState({
    subject: null, known: 'English', learning: '', topic: '', focus: '',
    presetIndex: 0, front: '', back: '', frontHint: '', backHint: '',
    count: 20, level: 'Beginner', alternatives: true, name: '',
  });
  const set = (patch) => setV((cur) => ({ ...cur, ...patch }));

  const valid = [
    Boolean(v.subject) && (v.subject !== 'other' || v.topic.trim()),
    v.subject === 'language' ? v.known.trim() && v.learning.trim() : v.subject === 'other' || v.topic.trim(),
    v.front.trim() && v.back.trim(),
    true,
    false, // the finish step has its own button
  ];

  function go(delta) {
    const nextStep = step + delta;
    // Entering "front & back": start from the preset for this subject, and
    // name the deck after what's being learned (editable at the end).
    if (STEPS[nextStep] === 'sides' && delta > 0) {
      set({ ...presetFor(v.subject, v, v.presetIndex), name: defaultDeckName(v) });
    }
    setDir(delta);
    setStep(nextStep);
  }

  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 24 * dir },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 * dir, transition: { duration: 0.12 } },
      };

  return (
    <form
      className="sheet__body builder"
      onSubmit={(e) => { e.preventDefault(); if (valid[step]) go(1); }}
    >
      {!pasteOnly && (
        <div className="builder__progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => <span key={s} className={i <= step ? 'is-done' : ''} />)}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} className="builder__step" {...slide} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
          {STEPS[step] === 'subject' && <SubjectStep v={v} set={set} />}
          {STEPS[step] === 'topic' && <TopicStep v={v} set={set} />}
          {STEPS[step] === 'sides' && <SidesStep v={v} set={set} />}
          {STEPS[step] === 'size' && <SizeStep v={v} set={set} />}
          {STEPS[step] === 'finish' && (
            <FinishStep v={v} set={set} pasteOnly={pasteOnly} onCreate={onCreate} onBack={pasteOnly ? null : () => go(-1)} />
          )}
        </motion.div>
      </AnimatePresence>

      {STEPS[step] !== 'finish' && (
        <SheetActions>
          <Button type="submit" disabled={!valid[step]}>
            Continue
          </Button>
          {step > 0 && <Button variant="secondary" onClick={() => go(-1)}>Back</Button>}
        </SheetActions>
      )}
    </form>
  );
}

function StepHead({ title, text }) {
  return (
    <header className="builder__head">
      <h3 className="builder__title">{title}</h3>
      {text && <p className="builder__text">{text}</p>}
    </header>
  );
}

function Choice({ name, value, checked, onChange, children }) {
  return (
    <label className={`choice ${checked ? 'is-checked' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

function Chips({ options, value, onChange, label }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const val = typeof o === 'object' ? o.value : o;
        const text = typeof o === 'object' ? o.label : o;
        return (
          <button
            key={val}
            type="button"
            role="radio"
            aria-checked={value === val}
            className={`chip ${value === val ? 'is-checked' : ''}`}
            onClick={() => onChange(val)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Steps -------------------------------------------------------------- */

function SubjectStep({ v, set }) {
  return (
    <>
      <StepHead title="What do you want to learn?" />
      <div className="choices">
        {SUBJECTS.map((s) => (
          <Choice
            key={s.id}
            name="subject"
            value={s.id}
            checked={v.subject === s.id}
            onChange={() => set({ subject: s.id, presetIndex: 0 })}
          >
            {s.label}
          </Choice>
        ))}
      </div>
      {v.subject === 'other' && (
        <Field label="What is it?">
          <input className="input" autoFocus value={v.topic} placeholder={TOPIC_HINTS.other}
            onChange={(e) => set({ topic: e.target.value })} />
        </Field>
      )}
    </>
  );
}

/** Optional focus: changes which cards the AI writes, not the deck's name. */
function FocusField({ v, set, placeholder }) {
  return (
    <Field label="Focus (optional)" hint="Narrows which cards the AI writes. Your deck’s name stays the same.">
      <input className="input" value={v.focus} placeholder={placeholder}
        onChange={(e) => set({ focus: e.target.value })} />
    </Field>
  );
}

function TopicStep({ v, set }) {
  if (v.subject === 'language') {
    return (
      <>
        <StepHead title="Which languages?" />
        <Field label="I speak">
          <input className="input" value={v.known} onChange={(e) => set({ known: e.target.value })} />
        </Field>
        <Field label="I’m learning">
          <input className="input" value={v.learning} placeholder="e.g. Dutch"
            onChange={(e) => set({ learning: e.target.value })} />
        </Field>
        <Chips options={LANGS} value={v.learning} onChange={(l) => set({ learning: l })} label="Popular languages" />
        <FocusField v={v} set={set} placeholder="e.g. food and ordering in a café" />
      </>
    );
  }
  if (v.subject === 'other') {
    return (
      <>
        <StepHead title={`Anything in particular about ${v.topic.trim() || 'it'}?`} text="You can skip this. The AI will cover the basics." />
        <FocusField v={v} set={set} placeholder="e.g. the Douro valley" />
      </>
    );
  }
  const label = SUBJECTS.find((s) => s.id === v.subject)?.label;
  return (
    <>
      <StepHead title={`Which part of ${label.toLowerCase()}?`} />
      <Field label="Topic">
        <input className="input" autoFocus value={v.topic} placeholder={TOPIC_HINTS[v.subject]}
          onChange={(e) => set({ topic: e.target.value })} />
      </Field>
    </>
  );
}

function exampleFor(v) {
  if (v.subject === 'language') {
    const back = THANK_YOU[v.learning.trim().toLowerCase()];
    if (back && /^english$/i.test(v.known.trim())) return ['thank you', back];
    return [null, null];
  }
  const ok = (x) => x && x !== '…';
  return [ok(v.exampleFront) ? v.exampleFront : null, ok(v.exampleBack) ? v.exampleBack : null];
}

/** The deck's name as the heading, renamed in place. */
function DeckNameHeading({ v, set }) {
  return (
    <h3 className="deck-heading">
      <AutoInput label="Deck name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
    </h3>
  );
}

function SidesStep({ v, set }) {
  const [ex1, ex2] = exampleFor(v);
  const swapped = v.subject === 'language' && v.front.trim() === v.learning.trim();
  const topic = (v.name || defaultDeckName(v)).toLowerCase();
  const [shownFront, shownBack] = swapped ? [ex2, ex1] : [ex1, ex2];
  return (
    <>
      <DeckNameHeading v={v} set={set} />
      <p className="step-head__text">Each row of this sheet becomes a card. You’ll see the left column, and answer with the right.</p>
      <div className="sheet-mock" role="group" aria-label="Your cards, as a sheet">
        <div className="sheet-mock__bar"><i /> {v.name || defaultDeckName(v)}</div>
        <div className="sheet-mock__grid">
          <span className="sheet-mock__col">A</span>
          <span className="sheet-mock__col">B</span>
          <span className="sheet-mock__cell sheet-mock__cell--head">
            <AutoInput label="Column A name (what you see)" value={v.front} onChange={(e) => set({ front: e.target.value, frontHint: '' })} />
          </span>
          <span className="sheet-mock__cell sheet-mock__cell--head">
            <AutoInput label="Column B name (what you answer)" value={v.back} onChange={(e) => set({ back: e.target.value, backHint: '' })} />
          </span>
          <span className="sheet-mock__cell">{shownFront || `A question about ${topic}`}</span>
          <span className="sheet-mock__cell">{shownBack || 'Its answer'}</span>
          <span className="sheet-mock__cell sheet-mock__cell--faint">…</span>
          <span className="sheet-mock__cell sheet-mock__cell--faint">…</span>
        </div>
      </div>
    </>
  );
}

function SizeStep({ v, set }) {
  return (
    <>
      <StepHead title="How many cards, and how hard?" />
      <div className="builder__group">
        <span className="field__label" id="size-label">Number of cards</span>
        <Segmented
          labelledBy="size-label"
          options={SIZES.map((n) => ({ value: n, label: String(n) }))}
          value={v.count}
          onChange={(n) => set({ count: n })}
        />
      </div>
      <div className="builder__group">
        <span className="field__label" id="level-label">Difficulty</span>
        <Segmented
          labelledBy="level-label"
          options={LEVELS.map((l) => ({ value: l, label: l }))}
          value={v.level}
          onChange={(l) => set({ level: l })}
        />
      </div>
    </>
  );
}

const AI_LINKS = [
  { name: 'ChatGPT', url: (p) => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
  { name: 'Claude', url: (p) => `https://claude.ai/new?q=${encodeURIComponent(p)}` },
  { name: 'Gemini', url: () => 'https://gemini.google.com/app' },
];

/*
 * The last step. By default Alle's own AI makes the cards: one button, a preview you can
 * edit, then Add deck. "Use your own AI instead" keeps the copy-the-prompt way.
 */
function FinishStep(props) {
  const { pasteOnly } = props;
  const [mode, setMode] = useState(pasteOnly ? 'own' : 'app');
  return mode === 'own'
    ? <OwnAiFinish {...props} onUseApp={pasteOnly ? null : () => setMode('app')} />
    : <AppAiFinish {...props} onUseOwn={() => setMode('own')} />;
}

/** "1 November": when the free AI decks come back (the count starts again each calendar month, UTC). */
export function resetDay(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** "Writing 20 Italian cards for a beginner…": what's being made, in the builder's own words. */
export function loadingText(v) {
  const level = (v.level || '').toLowerCase();
  const who = level === 'intermediate' ? 'an intermediate learner' : level === 'advanced' ? 'an advanced learner' : 'a beginner';
  if (v.subject === 'language' && v.learning) return `Writing ${v.count} ${v.learning} cards for ${who}…`;
  const topic = (v.topic || '').trim();
  return topic ? `Writing ${v.count} cards about ${topic.length > 40 ? `${topic.slice(0, 40)}…` : topic}…` : `Writing ${v.count} cards…`;
}

const AI_ERRORS = {
  limit: `You’ve used this month’s free AI decks. They come back on ${resetDay()}.`,
  not_available: 'Alle’s AI isn’t switched on yet. Use your own AI for now.',
  signed_out: 'Sign in again to use Alle’s AI.',
  offline: 'You seem to be offline. Check your connection and try again.',
  rate: 'That was quick! Wait a minute, then try again.',
};

function AppAiFinish({ v, set, onCreate, onBack, onUseOwn }) {
  const [name, setName] = useState(() => v.name || (v.subject ? defaultDeckName(v) : ''));
  const [allow, setAllow] = useState(null);
  const [state, setState] = useState({ status: 'idle', cards: null, error: '', preview: false });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [retrying, setRetrying] = useState(null); // index of the card being made again
  const [wantMore, setWantMore] = useState(false);
  useEffect(() => { let alive = true; aiAllowance().then((a) => alive && setAllow(a)); return () => { alive = false; }; }, []);

  const spec = { ...v, front: v.front, back: v.back };
  async function again(i) {
    if (retrying != null) return;
    setRetrying(i); setState((s) => ({ ...s, error: '' }));
    try {
      const card = state.cards[i];
      const avoid = state.cards.filter((_, j) => j !== i).map((c) => c.front);
      const r = await retryCard(spec, card, avoid);
      setState((s) => ({ ...s, cards: s.cards.map((c, j) => (j === i ? r.card : c)) }));
      track('ai_card_retried', { subject: v.subject });
    } catch (e) {
      setState((s) => ({ ...s, error: e.code === 'rate' ? AI_ERRORS.rate : 'That card couldn’t be made again. Try once more, or fix it by hand.' }));
    } finally { setRetrying(null); }
  }
  function askForMore() {
    setWantMore(true);
    track('ai_more_wanted', { subject: v.subject });
  }
  async function make() {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const r = await generateCards(spec);
      setState({ status: 'done', cards: r.cards, error: '', preview: Boolean(r.preview) });
      setAllow((a) => (a ? { ...a, left: r.left } : a));
      track('ai_deck_generated', { subject: v.subject, cards: r.cards.length });
    } catch (e) {
      const msg = AI_ERRORS[e.code] || 'The cards couldn’t be made this time. Try again, or use your own AI.';
      if (e.code === 'limit') setAllow((a) => (a ? { ...a, left: 0 } : a));
      setState((s) => ({ ...s, status: s.cards ? 'done' : 'idle', error: msg }));
    }
  }
  const editCard = (i, patch) => setState((s) => ({ ...s, cards: s.cards.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const removeCard = (i) => setState((s) => ({ ...s, cards: s.cards.filter((_, j) => j !== i) }));
  const ready = (state.cards || []).filter((c) => c.front.trim() && c.back.trim());

  async function add() {
    if (!ready.length) return;
    setBusy(true); setSaveError('');
    try {
      track('ai_deck_created', { subject: v.subject, learning: v.subject === 'language' ? v.learning : undefined, inApp: true });
      await onCreate({
        title: name.trim() || v.back,
        csv_url: null,
        front_label: v.front.trim(),
        back_label: v.back.trim(),
        lang: inferLang(v.subject === 'language' ? v.learning : v.back),
        cards: ready.map((c) => ({ front: c.front.trim(), back: c.back.trim() })),
      });
    } catch (e) { setSaveError(e.message); setBusy(false); }
  }

  const facts = [`${v.count} cards`, v.level, `${v.front} → ${v.back}`, v.focus.trim() && `Focus: ${v.focus.trim()}`].filter(Boolean);
  const out = allow && (!allow.enabled || allow.left <= 0);
  const allowText = !allow ? '' : !allow.enabled ? AI_ERRORS.not_available
    : allow.left <= 0 ? AI_ERRORS.limit
    : allow.left >= 999 ? '' : `${allow.left} of ${allow.limit} free AI ${allow.limit === 1 ? 'deck' : 'decks'} left this month. They come back on ${resetDay()}.`;

  return (
    <>
      <DeckNameHeading v={{ ...v, name }} set={(p) => { if ('name' in p) { setName(p.name); set(p); } }} />
      <p className="finish-facts">{facts.join(' · ')}</p>

      {state.status !== 'done' && (
        <div className="ai-make">
          {state.status === 'loading' ? (
            <div className="ai-make__loading" role="status"><span className="mini-spinner" aria-hidden="true" />{loadingText(v)}</div>
          ) : (
            <Button icon="sparkle" onClick={make} disabled={out}>Create my deck</Button>
          )}
          {allowText && state.status !== 'loading' && <p className="field__hint">{allowText}</p>}
          {out && allow?.enabled && state.status !== 'loading' && (wantMore
            ? <p className="field__hint ai-more__thanks" role="status">Thanks! That helps us decide. For now you can still use your own AI below.</p>
            : <button type="button" className="text-btn ai-more" onClick={askForMore}>Want more AI decks? Let us know</button>)}
        </div>
      )}
      {state.error && <p className="form-error" role="alert">{state.error}</p>}

      {state.status === 'done' && state.cards && (
        <div className="ai-cards" aria-label="Your new cards">
          <p className="preview-list__head">{ready.length} cards · {v.front} → {v.back}</p>
          {state.preview && <p className="field__hint">Pretend cards: Alle’s AI isn’t switched on in this test version yet.</p>}
          <ol className="ai-cards__list">
            {state.cards.map((c, i) => (
              <li key={i} className="ai-cards__row">
                <textarea className="ai-cards__input" rows={1} value={c.front} aria-label={`Card ${i + 1}, ${v.front}`} onChange={(e) => editCard(i, { front: e.target.value })} />
                <textarea className="ai-cards__input" rows={1} value={c.back} aria-label={`Card ${i + 1}, ${v.back}`} onChange={(e) => editCard(i, { back: e.target.value })} />
                <span className="ai-cards__tools">
                  <button type="button" className="ai-cards__remove" aria-label={`Try card ${i + 1} again`} title="Try this card again" disabled={retrying != null} onClick={() => again(i)}>
                    {retrying === i ? <span className="mini-spinner" aria-hidden="true" /> : <Icon name="reset" />}
                  </button>
                  <button type="button" className="ai-cards__remove" aria-label={`Remove card ${i + 1}`} title="Remove this card" onClick={() => removeCard(i)}><Icon name="close" /></button>
                </span>
              </li>
            ))}
          </ol>
          <p className="field__hint">Made by AI, so it can make mistakes. Fix any card here, or tap <Icon name="reset" className="inline-icon" /> to try it again.</p>
          {!out && <button type="button" className="text-btn ai-cards__again" onClick={make} disabled={state.status === 'loading'}>Make different cards</button>}
        </div>
      )}

      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <SheetActions>
        {state.status === 'done' && <Button onClick={add} disabled={!ready.length || busy}>{busy ? 'Adding…' : 'Add deck'}</Button>}
        {onBack && <Button variant="secondary" onClick={onBack}>Back</Button>}
        <button type="button" className={`text-btn ${out ? '' : 'text-btn--quiet'}`} onClick={onUseOwn}>{out ? 'Use your own AI' : 'Prefer another AI chat? Use your own'}</button>
      </SheetActions>
    </>
  );
}

/** Your own AI: the prompt to copy (or open in an AI chat), and the box to paste the reply into. */
function OwnAiFinish({ v, set, pasteOnly, onCreate, onBack, onUseApp }) {
  const prompt = useMemo(() => (pasteOnly ? '' : buildPrompt({ ...v, topicFocus: v.focus })), [v, pasteOnly]);
  const [copied, setCopied] = useState(false);
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [name, setName] = useState(() => v.name || (v.subject ? defaultDeckName(v) : ''));
  const [fixes, setFixes] = useState({}); // card index → { front, back } or { removed: true }
  useEffect(() => { setFixes({}); }, [raw]);

  async function copy() {
    try { await navigator.clipboard.writeText(prompt); } catch {
      const el = document.getElementById('ai-prompt');
      if (el) {
        const range = document.createRange(); range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
        document.execCommand?.('copy');
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  const parsed = useMemo(() => {
    if (!raw.trim()) return null;
    try { return { deck: parseLooseTable(raw) }; } catch (e) {
      return { error: e instanceof DeckImportError ? e.message : 'Those cards couldn’t be read. Copy the whole reply, including the first row.' };
    }
  }, [raw]);

  // The pasted cards with the person's fixes to the ones Alle flagged
  const cards = useMemo(() => (parsed?.deck
    ? parsed.deck.cards.map((c, i) => (fixes[i] ? { ...c, ...fixes[i] } : c)).filter((c) => !c.removed && c.front.trim() && c.back.trim())
    : []), [parsed, fixes]);
  const fix = (i, patch) => setFixes((f) => ({ ...f, [i]: { ...(f[i] || {}), ...patch } }));

  async function create() {
    if (!parsed?.deck || !cards.length) return;
    setBusy(true); setSaveError('');
    try {
      const d = parsed.deck;
      track('ai_deck_created', { subject: v.subject, learning: v.subject === 'language' ? v.learning : undefined });
      await onCreate({
        title: name.trim() || d.backLabel,
        csv_url: null,
        front_label: d.frontLabel,
        back_label: d.backLabel,
        lang: inferLang(v.subject === 'language' ? v.learning : d.backLabel),
        cards: cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })),
      });
    } catch (e) {
      setSaveError(e.message);
      setBusy(false);
    }
  }

  const facts = [`${v.count} cards`, v.level, `${v.front} → ${v.back}`, v.focus.trim() && `Focus: ${v.focus.trim()}`].filter(Boolean);

  return (
    <>
      {pasteOnly ? (
        <StepHead title="Paste the AI’s reply" text="Paste the whole reply from ChatGPT, Claude or any AI. Alle picks out the cards." />
      ) : (
        <>
          <DeckNameHeading v={{ ...v, name }} set={(p) => { if ('name' in p) { setName(p.name); set(p); } }} />
          <p className="finish-facts">{facts.join(' · ')}</p>
          <div className="finish-block">
            <p className="finish-block__title"><span className="finish-block__n">1</span>Copy the prompt and paste it into your AI chat</p>
            <Button icon={copied ? 'check' : 'copy'} onClick={copy}>{copied ? 'Copied' : 'Copy prompt'}</Button>
            <p className="finish-block__links">
              Or open it in{' '}
              {AI_LINKS.map((a, i) => (
                <span key={a.name}>
                  {i > 0 && (i === AI_LINKS.length - 1 ? ' or ' : ', ')}
                  <a href={a.url(prompt)} target="_blank" rel="noreferrer" onClick={copy}>{a.name}</a>
                </span>
              ))}
            </p>
            <details className="finish-prompt">
              <summary>See the prompt</summary>
              <pre className="prompt-box__text" id="ai-prompt">{prompt}</pre>
            </details>
          </div>
          <p className="finish-block__title"><span className="finish-block__n">2</span>Paste the AI’s reply here</p>
        </>
      )}

      <textarea
        className="input input--area"
        rows={4}
        value={raw}
        aria-label="The AI’s reply"
        placeholder={pasteOnly ? 'Paste the reply here' : `| ${v.front || 'Front'} | ${v.back || 'Back'} |\n…`}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setRaw(e.target.value)}
      />
      {parsed?.error && <p className="form-error" role="alert">{parsed.error}</p>}
      {parsed?.deck && (
        <div className="preview-list" aria-label="Preview" data-hj-suppress>
          <p className="preview-list__head">
            {cards.length} cards · {parsed.deck.frontLabel} → {parsed.deck.backLabel}
          </p>
          {cards.slice(0, 4).map((c, i) => (
            <div key={i} className="preview-list__row">
              {imageSrc(c.front)
                ? <img className={`preview-list__img ${needsFrame(c.front) ? 'is-framed' : ''}`} src={imageSrc(c.front)} alt={c.front} referrerPolicy="no-referrer" />
                : <span>{c.front}</span>}
              <span>{c.back.replace(/\|/g, ' / ')}</span>
            </div>
          ))}
          <p className="field__hint">Made by AI: check a few answers, it can make mistakes.</p>
        </div>
      )}
      {parsed?.deck?.check?.length > 0 && (
        <div className="ai-cards ai-check" aria-label="Cards to check" data-hj-suppress>
          <p className="preview-list__head">Check {parsed.deck.check.length === 1 ? 'this card' : `these ${parsed.deck.check.length} cards`}</p>
          <p className="field__hint">They had extra commas, so Alle had to guess where the answer starts. Fix them here, or remove them.</p>
          <ol className="ai-cards__list">
            {parsed.deck.check.filter(({ index }) => !fixes[index]?.removed).map(({ index, original }) => {
              const c = { ...parsed.deck.cards[index], ...(fixes[index] || {}) };
              return (
                <li key={index} className="ai-check__item">
                  <p className="ai-check__original">Pasted: <span>{original}</span></p>
                  <div className="ai-cards__row">
                    <textarea className="ai-cards__input" rows={1} value={c.front} aria-label={`${parsed.deck.frontLabel}, card to check`} onChange={(e) => fix(index, { front: e.target.value })} />
                    <textarea className="ai-cards__input" rows={1} value={c.back} aria-label={`${parsed.deck.backLabel}, card to check`} onChange={(e) => fix(index, { back: e.target.value })} />
                    <button type="button" className="ai-cards__remove" aria-label="Remove this card" onClick={() => fix(index, { removed: true })}><Icon name="close" /></button>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {pasteOnly && parsed?.deck && (
        <Field label="Deck name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <SheetActions>
        <Button onClick={create} disabled={!parsed?.deck || !cards.length || busy}>{busy ? 'Creating…' : 'Create deck'}</Button>
        {onBack && <Button variant="secondary" onClick={onBack}>Back</Button>}
        {onUseApp && <button type="button" className="text-btn" onClick={onUseApp}>Let Alle make the cards</button>}
      </SheetActions>
    </>
  );
}
