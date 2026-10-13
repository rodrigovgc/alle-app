import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { getConsent, setConsent } from '../lib/hotjar.js';

/** Asks once whether Alle may use Hotjar. The answer can be changed later in Account. */
export function Consent() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (getConsent()) return undefined;
    const t = setTimeout(() => setOpen(true), 1200); // let the app settle first
    return () => clearTimeout(t);
  }, []);
  const choose = (v) => { setConsent(v); setOpen(false); };
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="consent"
          role="dialog"
          aria-label="Cookies"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 34 }}
        >
          <p className="consent__text">
            Help us make Alle better? We’d like to use Hotjar to see how people move around the app. It sets cookies, so it only runs if you agree.{' '}
            <a href="https://allecards.app/privacy#cookies" target="_blank" rel="noreferrer">Learn more</a>
          </p>
          <div className="consent__row">
            <button type="button" className="consent__no" onClick={() => choose('denied')}>No thanks</button>
            <button type="button" className="consent__yes" onClick={() => choose('granted')}>Accept</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
