import { useCallback, useLayoutEffect, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { IconButton } from './Button.jsx';
import { SPRING } from '../styles/tokens.js';
import { useKeyboardInset } from '../lib/useViewport.js';
import { useFocusIntoView } from '../lib/useFocusIntoView.js';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';

/**
 * Overlay sheet with rounded top corners over a dimmed page.
 *   variant="page"   — tall, for forms. Starts just under the status bar, so
 *                      fields sit high and the keyboard never has to push it.
 *   variant="dialog" — fits its content, for short confirmations.
 * The header never scrolls. The sheet runs to the bottom edge of the screen,
 * so the area around the keyboard is always the sheet's own white.
 */
export function Sheet({ open, onClose, title, children, variant = 'page', wide = false }) {
  const reduce = useReducedMotion();
  const sheetRef = useRef(null);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  useKeyboardInset(open && !desktop);

  // Desktop: a centred popup that fades and scales in. Mobile: unchanged.
  const motionProps = desktop
    ? {
        initial: { opacity: 0, scale: reduce ? 1 : 0.96, y: reduce ? 0 : 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.14 } },
        transition: SPRING.sheet,
      }
    : {
        initial: reduce ? { opacity: 0 } : { y: '100%' },
        animate: reduce ? { opacity: 1 } : { y: 0 },
        exit: reduce ? { opacity: 0 } : { y: '100%' },
        transition: SPRING.sheet,
      };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="sheet-scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <div key="frame" className={desktop ? 'popup-frame' : undefined} style={desktop ? undefined : { display: 'contents' }}>
            <motion.section
              className={`sheet sheet--${variant} ${desktop ? 'sheet--popup' : ''} ${wide ? 'sheet--wide' : ''} is-moving`}
              // Chrome flickers frosted (backdrop-blur) layers while their parent
              // fades or scales, so they stay solid until the sheet has landed.
              onAnimationStart={() => sheetRef.current?.classList.add('is-moving')}
              onAnimationComplete={() => sheetRef.current?.classList.remove('is-moving')}
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              {...motionProps}
            >
              <SheetFrame title={title} onClose={onClose}>{children}</SheetFrame>
            </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

function SheetFrame({ title, onClose, children }) {
  // The header floats over the content (which scrolls underneath and blurs).
  // Publish its height so the content starts just below it.
  const headRef = useRef(null);
  useLayoutEffect(() => {
    const head = headRef.current;
    const sheet = head?.parentElement;
    if (!head || !sheet) return undefined;
    const set = () => sheet.style.setProperty('--sheet-head-h', `${head.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  const scrollRef = useRef(null);
  useFocusIntoView(scrollRef);
  // Hairlines only when there's something underneath: above (scrolled) or below (more to see)
  const edges = useCallback(() => {
    const el = scrollRef.current; const sheet = el?.parentElement;
    if (!el || !sheet) return;
    sheet.classList.toggle('is-scrolled', el.scrollTop > 2);
    sheet.classList.toggle('has-more', el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    edges();
    const ro = new ResizeObserver(edges);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [edges]);
  return (
    <>
      <header className="sheet__header" ref={headRef}>
        <h2 className="sheet__title">{title}</h2>
        <IconButton icon="close" label="Close" onClick={onClose} className="icon-btn--inner" />
      </header>
      <div
        className="sheet__scroll"
        ref={scrollRef}
        onScroll={edges}
      >{children}</div>
    </>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

/** Buttons at the end of a sheet. They stick just above the keyboard. */
export function SheetActions({ children }) {
  return <div className="sheet__actions">{children}</div>;
}
