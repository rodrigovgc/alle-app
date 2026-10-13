import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Button } from './Button.jsx';
import { Logo } from './Icon.jsx';
import { SCENES } from './Scenes.jsx';

/*
 * First-run tour: six calm steps, each with a small looping scene drawn in
 * Alle's own style. Swipe or use Next/Back; Skip at any time. Shown once after
 * signing up, and again from Help.
 */

const HELP_URL = 'https://allecards.app/help';

const STEPS = [
  {
    key: 'welcome',
    title: 'Welcome to Alle',
    text: 'Flashcards that bring back what you’re about to forget.',
    Scene: SCENES.welcome,
  },
  {
    key: 'ready',
    title: 'Pick a ready-made deck',
    text: 'Choose one and try a short session to see how Alle works.',
    Scene: SCENES.ready,
  },
  {
    key: 'sheets',
    title: 'Turn a Sheet into a deck',
    text: 'Paste your two-column Sheet into Alle and every row becomes a card.',
    Scene: SCENES.sheets,
  },
  {
    key: 'ai',
    title: 'Create a deck with AI',
    text: 'Let Alle make the cards (3 free decks a month), or use the prompt with your own AI.',
    Scene: SCENES.ai,
  },
  {
    key: 'study',
    title: 'Study your way',
    text: 'Choose multiple choice or typing. Cards you miss come back for another try.',
    Scene: SCENES.study,
  },
  {
    key: 'home',
    title: 'Add Alle to your Home Screen',
    text: 'In Safari, tap Share → Add to Home Screen to use Alle like an app.',
    Scene: SCENES.home,
  },
];

export function Onboarding({ onDone }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const last = i === STEPS.length - 1;
  const step = STEPS[i];

  const go = (n) => {
    if (n < 0 || n >= STEPS.length) return;
    setDir(n > i ? 1 : -1);
    setI(n);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
      initial: (d) => ({ opacity: 0, x: d * 40 }),
      animate: { opacity: 1, x: 0 },
      exit: (d) => ({ opacity: 0, x: d * -40 }),
    };

  return (
    <div className="onb" role="dialog" aria-modal="true" aria-label="How to use Alle">
      <header className="onb__top">
        <Logo />
        {!last && <button type="button" className="text-btn onb__skip" onClick={onDone}>Skip</button>}
      </header>

      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.section
          key={step.key}
          className="onb__slide"
          custom={dir}
          {...slide}
          transition={{ duration: reduce ? 0.15 : 0.45, ease: [0.22, 1, 0.36, 1] }}
          drag={reduce ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.18}
          onDragEnd={(_, info) => {
            if (info.offset.x < -60) go(i + 1);
            else if (info.offset.x > 60) go(i - 1);
          }}
        >
          <div className="onb__stage" aria-hidden="true"><step.Scene /></div>
          <div className="onb__copy">
            <h2 className="onb__title">{step.title}</h2>
            <p className="onb__text">{step.text}</p>
            {last && (
              <a className="onb__more" href={HELP_URL} target="_blank" rel="noreferrer">More help and step-by-step guides</a>
            )}
          </div>
        </motion.section>
      </AnimatePresence>

      <footer className="onb__bottom">
        <div className="onb__dots" role="tablist" aria-label="Steps">
          {STEPS.map((s, n) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={`Step ${n + 1}: ${s.title}`}
              className={`onb__dot ${n === i ? 'is-on' : ''}`}
              onClick={() => go(n)}
            />
          ))}
        </div>
        <div className="onb__nav">
          {i > 0 && <Button variant="secondary" onClick={() => go(i - 1)}>Back</Button>}
          <Button onClick={() => (last ? onDone() : go(i + 1))}>{last ? 'Start learning' : 'Next'}</Button>
        </div>
      </footer>
    </div>
  );
}
