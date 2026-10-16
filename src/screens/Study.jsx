import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button, IconButton } from '../components/Button.jsx';
import { Tag } from '../components/Tag.jsx';
import { diffAnswer, evaluate } from '../lib/evaluate.js';
import { alternatives, displayLines } from '../lib/csv.js';
import { canSpeak, speak } from '../lib/speech.js';
import { warmVoice } from '../lib/voices.js';
import { useVisualViewport } from '../lib/useViewport.js';
import { useFitText } from '../lib/useFitText.js';
import { FixUp } from '../components/FixUp.jsx';
import { CardPicture } from '../components/CardPicture.jsx';
import { imageSrc, imageSources, needsFrame, clockTime, wikimediaFile, resolveImage } from '../lib/media.js';
import { ClockFace } from '../components/ClockFace.jsx';
import { makeOptions } from '../lib/srs.js';
import { SPRING, tokenNumber } from '../styles/tokens.js';


/** Controls fade in place; they never push the card around. */
const fade = (reduce) => ({
  initial: { opacity: 0, y: reduce ? 0 : 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
});

function Lines({ text }) {
  return displayLines(text.replace(/\s*\|\s*/g, ' / ')).map((l, i) => (
    <span key={i} className="line">{l}</span>
  ));
}

function Runs({ runs, markClass }) {
  return runs.map((r, i) =>
    r.mark ? <mark key={i} className={`mark ${markClass}`}>{r.text}</mark> : <span key={i}>{r.text}</span>);
}

/*
 * One card, two sides; the actions sit on the page below it.
 *  - Typing: the card, its stack, and the keyboard. The Go key answers.
 *  - Keyboard dismissed: Answer fades in at the bottom.
 *  - Answered: the card turns over and Next takes Answer's place. The
 *    verdict decides when the card comes back; there's nothing to rate.
 * The card's size and position never change, so only the card itself moves.
 */
export function Study({ cards: sessionCards, onReview, onExit, onFinish }) {
  useVisualViewport(true);
  const reduce = useReducedMotion();

  // The session can shrink: a card whose picture can't load is taken out
  // before (or as) it reaches the top, since it couldn't be answered.
  const [cards, setCards] = useState(sessionCards);
  const sessionTotal = useRef(sessionCards.length);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('question');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const inputRef = useRef(null);
  const busy = useRef(false);
  const correctRef = useRef(0);
  const [stage, setStage] = useState('study'); // 'study' | 'fix'
  const wrongCards = useRef([]);

  function dropCard(key) {
    setCards((list) => {
      const pos = list.findIndex((c) => c.key === key);
      if (pos < index) return list;                        // already studied
      if (pos === index && phase !== 'question') return list; // answer is showing
      return list.filter((c) => c.key !== key);
    });
  }
  const ended = useRef(false);
  function finishStudy() {
    if (ended.current) return;
    if (wrongCards.current.length) { setStage('fix'); return; }
    ended.current = true;
    onFinish({ correct: correctRef.current, total: Math.max(1, sessionTotal.current) });
  }
  useEffect(() => {
    if (ended.current || stage !== 'study') return;
    if (cards.length === 0) { ended.current = true; onExit(); }
    else if (index >= cards.length) finishStudy();
  }, [cards.length, index, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = cards.length;
  const card = cards[Math.min(index, Math.max(0, total - 1))];
  const isChoice = card.mode === 'choice';
  const correctOption = alternatives(card.back)[0];
  // Options are fixed per card, so they don't reshuffle while the card is up.
  const options = useMemo(
    () => (isChoice ? makeOptions(correctOption, card.pool) : null),
    [card.key, isChoice], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [picked, setPicked] = useState(null);

  /* ---- Card geometry ---------------------------------------------------
     The card's size depends only on the screen width, so it is identical
     while typing, after answering, and with the keyboard up or down. The
     stack behind it always stays. Proportions (--card-ratio) are chosen so
     card + stack fit above the keyboard on the smallest iPhone. */
  const t = useMemo(() => ({
    offset: tokenNumber('--stack-offset', 8),
    step: tokenNumber('--stack-scale-step', 0.03),
    depth: tokenNumber('--stack-depth', 3),
    ratio: tokenNumber('--card-ratio', 1.25),
  }), []);

  const stageRef = useRef(null);
  const [cardW, setCardW] = useState(0);
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const measure = () => setCardW((w) => (Math.abs(w - el.clientWidth) > 1 ? el.clientWidth : w));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxH = tokenNumber('--card-max-h', 560);
  const cardH = Math.min(cardW / t.ratio, maxH);
  // From the card's spot to fully past the left edge, with margin for the tilt.
  const throwDistance = () => {
    const left = stageRef.current?.getBoundingClientRect().left ?? 0;
    return left + cardW + cardH * 0.3 + 24;
  };

  // On phones the keyboard's Go key answers, so the Answer button steps aside
  // while the answer field has focus. Hardware keyboards keep the button.
  const coarse = useMemo(() => typeof window !== 'undefined'
    && window.matchMedia?.('(pointer: coarse)').matches, []);
  const [inputFocused, setInputFocused] = useState(false);
  const [revealing, setRevealing] = useState(false);

  /* ---- Flow ----------------------------------------------------------- */

  // Focus inside the same tap that opened the deck or dealt the card, so iOS
  // opens the keyboard. Re-runs once the card has its size.
  const sized = cardW > 0;
  useLayoutEffect(() => {
    if (phase === 'question' && sized && !isChoice) inputRef.current?.focus({ preventScroll: true });
  }, [index, phase, sized, isChoice]);

  function reveal({ skipped = false } = {}) {
    if (phase !== 'question' || busy.current) return;
    busy.current = true;
    setRevealing(true);
    const ta = inputRef.current;
    ta?.blur(); // commits any word the keyboard was still holding
    // Read the field itself, one frame later, so the check always sees
    // exactly what is on screen.
    requestAnimationFrame(() => {
      const value = skipped ? '' : (ta ? ta.value : typed);
      const r = skipped
        ? { verdict: 'wrong', match: alternatives(card.back)[0], skipped: true }
        : evaluate(value, card.back);
      setTyped(value);
      setResult(r);
      setPhase('answer');
      setRevealing(false);
      busy.current = false;
    });
  }

  function choose(option) {
    if (phase !== 'question' || busy.current || picked) return;
    busy.current = true;
    setPicked(option);
    const right = option === correctOption;
    // Let the colours register on the buttons, then turn the card.
    setTimeout(() => {
      setTyped(option);
      setResult({ verdict: right ? 'correct' : 'wrong', match: correctOption, mode: 'choice' });
      setPhase('answer');
      busy.current = false;
    }, reduce ? 150 : 650);
  }

  function next() {
    if (phase !== 'answer' || busy.current) return;
    busy.current = true;
    const newCorrect = correctCount + (result.verdict === 'correct' ? 1 : 0);
    onReview(card, result.verdict);
    if (result.verdict !== 'correct' && !wrongCards.current.some((c) => c.key === card.key)) {
      wrongCards.current.push(card); // every miss comes back in "Let's fix these"
    }
    correctRef.current = newCorrect;
    setCorrectCount(newCorrect);
    // Always advance the index; the effect above turns the last step into the
    // Done screen. One path, so finishing can't get stuck.
    setPhase('question');
    setTyped('');
    setResult(null);
    setPicked(null);
    setIndex((i) => i + 1);
    busy.current = false;
  }

  // Hardware keyboard: Enter = Next on the back; 1–4 pick an option.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('textarea, input, select')) return;
      if (phase === 'question' && options) {
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) choose(options[n - 1]);
        return;
      }
      if (phase !== 'answer' || e.target.closest?.('button')) return;
      if (e.key === 'Enter') { e.preventDefault(); next(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slots = cards.slice(index, index + 1 + t.depth);
  const flipped = phase === 'answer';
  const controls = flipped ? 'rate'
    : isChoice ? 'choice'
    : (revealing || (coarse && inputFocused)) ? null : 'answer';

  if (stage === 'fix') {
    return (
      <FixUp
        cards={wrongCards.current}
        sessionTotal={sessionTotal.current}
        baseCorrect={correctRef.current}
        onExit={onExit}
        onDone={({ fixed }) => {
          ended.current = true;
          // Fixed cards count toward the celebration score (but the schedule
          // already marked them wrong, so they still return sooner).
          onFinish({ correct: Math.min(sessionTotal.current, correctRef.current + fixed), total: Math.max(1, sessionTotal.current) });
        }}
      />
    );
  }

  return (
    <div className="study">
      <nav className="study__nav">
        <IconButton icon="close" label="Close deck" onClick={onExit} />
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1}>
          <span className="progress__fill" style={{ '--progress': (index + 1) / total }} />
        </div>
        <span className="study__count">{index + 1}/{total}</span>
      </nav>

      <div className="study__stage" ref={stageRef}>
        <div className="study__deck" style={{ width: cardW, height: cardH }}>
          <AnimatePresence initial={false}>
            {slots.map((c, slot) => {
              const front = slot === 0;
              return (
                <motion.div
                  key={index + slot}
                  className={`study-card ${front ? 'is-front' : 'is-behind'}`}
                  aria-hidden={!front}
                  inert={front ? undefined : ''}
                  initial={{ y: (slot + 1) * t.offset, scale: 1 - (slot + 1) * t.step, opacity: 0 }}
                  animate={{ y: slot * t.offset, scale: 1 - slot * t.step, opacity: 1, zIndex: t.depth + 1 - slot }}
                  exit={reduce
                    ? { opacity: 0, transition: { duration: 0.15 } }
                    : {
                        // Throw it clear of the screen edge, whatever the screen width.
                        x: -(throwDistance()),
                        rotate: -10,
                        zIndex: 20,
                        transition: {
                          x: { duration: 0.42, ease: [0.45, 0, 0.55, 1] },
                          rotate: { duration: 0.42, ease: [0.45, 0, 0.55, 1] },
                          zIndex: { duration: 0 },
                        },
                      }}
                  transition={reduce ? { duration: 0 } : SPRING.stack}
                >
                  {front ? (
                    <motion.div
                      className="study-card__flipper"
                      initial={false}
                      animate={{ rotateY: flipped ? 180 : 0 }}
                      transition={reduce ? { duration: 0 } : SPRING.flip}
                    >
                      <div className={`study-card__face ${flipped ? 'is-hidden' : ''}`}>
                        <FrontFace
                          card={c}
                          canSkip={!flipped}
                          interactive={!flipped && c.mode !== 'choice'}
                          typed={typed}
                          setTyped={setTyped}
                          inputRef={inputRef}
                          onBroken={() => dropCard(c.key)}
                          onFocusChange={setInputFocused}
                          onSkip={() => reveal({ skipped: true })}
                          onSubmit={() => reveal()}
                        />
                      </div>
                      <div className={`study-card__face study-card__face--back ${flipped ? '' : 'is-hidden'}`} aria-hidden={!flipped}>
                        {result && <BackFace card={c} typed={typed} result={result} />}
                      </div>
                    </motion.div>
                  ) : (
                    <div className="study-card__face">
                      <FrontFace card={c} interactive={false} typed="" onBroken={() => dropCard(c.key)} />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="study__controls">
        <AnimatePresence initial={false} mode="popLayout">
          {controls === 'rate' && (
            <motion.div key="rate" className="study__controls-set" {...fade(reduce)}>
              <Button onClick={next}>Next</Button>
            </motion.div>
          )}
          {controls === 'choice' && (
            <motion.div key={`choice-${index}`} className="study__controls-set choices-quiz" {...fade(reduce)}>
              {options.map((o, i) => {
                const state = !picked ? '' : o === correctOption ? 'is-right' : o === picked ? 'is-wrong' : 'is-dim';
                return (
                  <button
                    key={o}
                    type="button"
                    className={`quiz-option ${state}`}
                    disabled={Boolean(picked)}
                    aria-keyshortcuts={String(i + 1)}
                    onClick={() => choose(o)}
                  >
                    {o}
                  </button>
                );
              })}
            </motion.div>
          )}
          {controls === 'answer' && (
            <motion.div key="answer" className="study__controls-set" {...fade(reduce)}>
              <Button onPointerDown={(e) => e.preventDefault()} onClick={() => reveal()}>Answer</Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** A picture on the card. If it can't load, say so instead of showing a broken image. */
function FrontFace({ card, interactive, canSkip, typed, setTyped, inputRef, onFocusChange, onSkip, onSubmit, onBroken }) {
  const picture = imageSrc(card.front);
  const clock = clockTime(card.front);
  const typedMode = card.mode !== 'choice';
  const promptRef = useRef(null);
  // Fit only the PROMPT, and only when the card changes — not on every keystroke.
  // This stops the title from jumping around as you type a long answer.
  const fit = useFitText(promptRef, [card.key]);

  // The answer grows with its text up to a cap, then scrolls inside itself.
  useLayoutEffect(() => {
    const ta = inputRef?.current;
    if (!ta || !interactive) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, ta.offsetParent ? 9999 : ta.scrollHeight)}px`;
  }, [typed, interactive, inputRef]);

  return (
    <>
      <header className="study-card__header">
        <span className="study-card__label">{card.frontLabel}</span>
        <button type="button" className="skip" onClick={onSkip} tabIndex={canSkip ? 0 : -1}>Skip</button>
      </header>

      <div className="study-card__body" data-hj-suppress onClick={() => interactive && inputRef?.current?.focus()}>
        <div
          ref={promptRef}
          className={`study-card__prompt ${picture || clock ? 'has-picture' : ''}`}
          data-fit={fit}
        >
          {clock
            ? <div className="study-card__picture-wrap"><ClockFace h={clock.h} m={clock.m} /></div>
            : picture
              ? <CardPicture cell={card.front} sources={imageSources(card.front)} framed={needsFrame(card.front)} onBroken={onBroken} />
              : <p className="study-card__text"><Lines text={card.front} /></p>}
        </div>
        {!typedMode ? null : interactive ? (
          <textarea
            ref={inputRef}
            className="study-card__input"
            value={typed}
            placeholder="Type answer…"
            rows={1}
            enterKeyHint="go"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
            aria-label={`Your answer in ${card.backLabel}`}
            onChange={(e) => setTyped(e.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        ) : (
          <span className="study-card__input study-card__input--static">{typed || 'Type answer…'}</span>
        )}
      </div>
    </>
  );
}

function BackFace({ card, typed, result }) {
  const bodyRef = useRef(null);
  const fit = useFitText(bodyRef, [card.key, result.match, typed]);

  useEffect(() => { warmVoice(card.lang); }, [card.lang]); // natural voice ready before the speaker is tapped

  const answerText = result.match.replace(/\s*•\s*/g, '\n');
  const hasTyped = result.verdict !== 'correct' && !result.skipped && typed.trim();
  const diff = hasTyped && result.mode !== 'choice' ? diffAnswer(typed, answerText) : null;
  const showDiff = diff && diff.changed <= 0.5;
  const others = alternatives(card.back).filter((a) => a !== result.match);

  return (
    <>
      <header className="study-card__header">
        <span className="study-card__label">{card.backLabel}</span>
        {canSpeak() && (
          <IconButton
            icon="speaker"
            label="Read answer aloud"
            className="icon-btn--inner icon-btn--card"
            onClick={() => speak(card.back, card.lang)}
          />
        )}
      </header>

      <div ref={bodyRef} className="study-card__body" data-hj-suppress data-fit={fit}>
        {hasTyped && (
          <p
            className={`study-card__text study-card__text--typed ${showDiff ? '' : 'is-struck'}`}
            aria-label={`You wrote: ${typed}`}
          >
            {showDiff ? <Runs runs={diff.typed} markClass="mark--wrong" /> : typed}
          </p>
        )}
        <p className="study-card__text" aria-label={`${card.backLabel}: ${result.match}`}>
          {showDiff ? <Runs runs={diff.answer} markClass="mark--fix" /> : <Lines text={result.match} />}
        </p>
        {others.length > 0 && (
          <p className="study-card__helper">Also accepted: {others.join(', ')}</p>
        )}
        <div className="study-card__verdict"><Tag verdict={result.verdict} /></div>
      </div>
    </>
  );
}
