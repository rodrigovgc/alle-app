import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button, IconButton } from './Button.jsx';
import { Tag } from './Tag.jsx';
import { CardPicture } from './CardPicture.jsx';
import { ClockFace } from './ClockFace.jsx';
import { alternatives } from '../lib/csv.js';
import { normalise } from '../lib/evaluate.js';
import { imageSrc, imageSources, needsFrame, clockTime } from '../lib/media.js';
import { SPRING } from '../styles/tokens.js';

/*
 * "Let's fix these": missed cards come back as word ordering. Same card as the
 * study screen (with its stack); the prompt or picture sits in the middle with
 * the placed words under it, and the word bank waits below the card. A lifted
 * word leaves its slot behind so the bank never reflows. Getting it right
 * counts toward the celebration but doesn't change the card's schedule.
 */

const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};
// Typing on a keyboard: "e" matches "é", case doesn't matter, punctuation is ignored.
const fold = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const bare = (w) => fold(w).replace(/[^\p{L}\p{N}]/gu, '');

const wordsOf = (answer) => answer.replace(/\s*•\s*/g, ' ').trim().split(/\s+/);
const LETTERS = 'abcdefghijklmnoprstuvwz';

/** Pieces to rebuild: words for a phrase, letters for a single word. */
function piecesOf(answer) {
  const words = wordsOf(answer);
  return words.length > 1 ? { pieces: words, joiner: ' ' } : { pieces: [...words[0]], joiner: '' };
}

export function FixUp({ cards, sessionTotal, baseCorrect = 0, onExit, onDone }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [fixedCount, setFixedCount] = useState(0);
  const [placed, setPlaced] = useState([]);   // chip ids in order
  const [checked, setChecked] = useState(null); // null | 'right' | 'wrong'

  const card = cards[index];
  const answer = useMemo(() => alternatives(card.back)[0], [card.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const { pieces: target, joiner } = useMemo(() => piecesOf(answer), [answer]);
  const bank = useMemo(() => {
    let distractors;
    if (joiner === ' ') {
      // Phrase: a couple of words from other missed cards
      distractors = shuffle(
        cards.filter((c) => c.key !== card.key)
          .flatMap((c) => wordsOf(alternatives(c.back)[0]))
          .filter((w) => !target.includes(w)),
      ).slice(0, Math.min(2, Math.max(0, 6 - target.length)));
    } else {
      // Single word: a couple of extra letters (or digits, for numbers)
      const pool = /^\d+$/.test(answer) ? '0123456789' : LETTERS;
      distractors = shuffle([...pool].filter((ch) => !target.includes(ch))).slice(0, target.length > 8 ? 1 : 2);
    }
    return shuffle(target.concat(distractors)).map((w, i) => ({ id: `${w}-${i}`, w }));
  }, [card.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const placedSet = new Set(placed);
  const placedChips = placed.map((id) => bank.find((c) => c.id === id));
  const attempt = placedChips.map((c) => c.w).join(joiner);

  const picture = imageSrc(card.front);
  const clock = clockTime(card.front);
  const long = !picture && !clock && card.front.length > 48;

  const denom = Math.max(1, sessionTotal || cards.length);
  const shownNum = Math.min(denom, baseCorrect + index);

  function place(chip) {
    if (checked || placedSet.has(chip.id)) return;
    setPlaced((p) => [...p, chip.id]);
  }
  function removeAt(i) {
    if (checked) return;
    setPlaced((p) => p.filter((_, k) => k !== i));
  }
  function check() {
    const ok = alternatives(card.back).some((alt) => normalise(alt) === normalise(attempt));
    setChecked(ok ? 'right' : 'wrong');
    if (ok) setFixedCount((n) => n + 1);
  }
  function skip() { if (!checked) setChecked('wrong'); }
  function nextCard() {
    if (index + 1 >= cards.length) { onDone({ fixed: fixedCount, total: cards.length }); return; }
    setIndex(index + 1);
    setPlaced([]);
    setChecked(null);
    setTyped('');
  }

  // ---- Keyboard: type to place chips (clicking still works) ----
  const [typed, setTyped] = useState('');   // the word being typed (phrases only)
  const [miss, setMiss] = useState(0);      // brief nudge when nothing matches
  const free = bank.filter((c) => !placedSet.has(c.id));
  const nudge = () => setMiss((n) => n + 1);

  function placeLetter(key) {
    const k = key.toLowerCase();
    const chip = free.find((c) => c.w.toLowerCase() === k) || free.find((c) => fold(c.w) === fold(k));
    if (chip) place(chip); else nudge();
  }
  // A word goes in when it's typed in full, or when Space/Enter picks the only match.
  function commitWord(text, force) {
    const t = bare(text);
    if (!t) return false;
    const exact = free.filter((c) => bare(c.w) === t);
    const longer = free.filter((c) => bare(c.w).startsWith(t) && bare(c.w) !== t);
    if (exact.length && (force || !longer.length)) { place(exact[0]); setTyped(''); return true; }
    if (force) {
      if (longer.length === 1) { place(longer[0]); setTyped(''); return true; }
      nudge();
    }
    return false;
  }

  useEffect(() => {
    function onKey(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (checked) {
        if (e.key === 'Enter') { e.preventDefault(); nextCard(); }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (joiner === ' ' && typed) commitWord(typed, true);
        else if (placed.length) check();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (typed) setTyped((t) => t.slice(0, -1));
        else if (placed.length) removeAt(placed.length - 1);
        return;
      }
      if (e.key === 'Escape') { setTyped(''); return; }
      if (e.key.length !== 1) return;
      if (joiner === '') {           // letters
        if (e.key === ' ') return;
        e.preventDefault(); placeLetter(e.key);
        return;
      }
      if (e.key === ' ') { e.preventDefault(); commitWord(typed, true); return; }
      e.preventDefault();
      const next = typed + e.key;
      if (!commitWord(next, false)) {
        const any = free.some((c) => bare(c.w).startsWith(bare(next)));
        if (any || !bare(next)) setTyped(next); else nudge();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="study fixup">
      <nav className="study__nav">
        <IconButton icon="close" label="Close deck" onClick={onExit} />
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={denom} aria-valuenow={shownNum}>
          <span className="progress__fill" style={{ '--progress': shownNum / denom }} />
        </div>
        <span className="study__count">{shownNum}/{denom}</span>
      </nav>

      <div className="fixup__deck">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section
            key={card.key}
            className="fixup__card" data-hj-suppress
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24, transition: { duration: 0.12 } }}
            transition={SPRING.flip}
          >
            <header className="study-card__header">
              <span className="study-card__label">Let’s fix these</span>
              {!checked && <button type="button" className="skip" onClick={skip}>Skip</button>}
            </header>

            <div className="fixup__body">
              {!checked ? (
                <>
                  {clock
                    ? <div className="fixup__picture"><ClockFace h={clock.h} m={clock.m} /></div>
                    : picture
                      ? <div className="fixup__picture"><CardPicture cell={card.front} sources={imageSources(card.front)} framed={needsFrame(card.front)} /></div>
                      : <p className={`fixup__prompt ${long ? 'is-long' : ''}`}>{card.front}</p>}
                  <div className="fixup__answer">
                    {placedChips.map((chip, i) => (
                      <button key={chip.id} type="button" className={`chip ${joiner ? '' : 'chip--letter'}`} onClick={() => removeAt(i)}>{chip.w}</button>
                    ))}
                    {typed && <span className="chip chip--typing" aria-live="polite">{typed}<i aria-hidden="true" /></span>}
                  </div>
                </>
              ) : (
                <>
                  {checked === 'wrong' && attempt && <p className="fixup__attempt">{attempt}</p>}
                  <p className="fixup__solution">{answer}</p>
                  <Tag verdict={checked === 'right' ? 'correct' : 'wrong'} />
                </>
              )}
            </div>
          </motion.section>
        </AnimatePresence>
      </div>

      {/* Word bank below the card; a lifted word leaves its slot behind */}
      <div className={`fixup__bank ${miss ? 'is-miss' : ''}`} key={`bank-${miss}`}>
        {!checked && bank.map((chip) => (
          placedSet.has(chip.id)
            ? <span key={chip.id} className={`chip chip--ghost ${joiner ? '' : 'chip--letter'}`} aria-hidden="true">{chip.w}</span>
            : <button key={chip.id} type="button" className={`chip chip--bank ${joiner ? '' : 'chip--letter'}`} onClick={() => place(chip)}>{chip.w}</button>
        ))}
      </div>
      {!checked && (
        <p className="fixup__keys">
          {joiner ? 'Type a word, or press Space to place it · Backspace to undo · Enter to check'
            : 'Type the letters · Backspace to undo · Enter to check'}
        </p>
      )}

      <div className="fixup__controls">
        {!checked
          ? <Button disabled={placed.length === 0} onClick={check}>Check</Button>
          : <Button onClick={nextCard}>{index + 1 >= cards.length ? 'See results' : 'Next'}</Button>}
      </div>
    </div>
  );
}
