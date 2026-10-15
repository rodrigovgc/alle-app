import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Icon } from './Icon.jsx';
import { wikimediaFile, resolveImage } from '../lib/media.js';

/**
 * A picture on the card. Tries each source in turn; if none loads, reports it
 * so the session can drop the card (a question without its picture can't be answered).
 */
export function CardPicture({ cell, sources, framed, onBroken }) {
  // Try the quick guesses first; if they all fail, ask Wikimedia's API for the
  // real URL before giving up. A plain broken card is dropped from the session.
  const file = wikimediaFile(cell);
  const [list, setList] = useState(sources);
  const [i, setI] = useState(0);
  const triedApi = useRef(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setZoom(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoom]);

  useEffect(() => { setList(sources); setI(0); triedApi.current = false; }, [cell]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onError() {
    if (i + 1 < list.length) { setI(i + 1); return; }
    if (file && !triedApi.current) {
      triedApi.current = true;
      const url = await resolveImage(file);
      if (url) { setList([url]); setI(0); return; }
    }
    onBroken?.();
  }

  if (i >= list.length) return <div className="study-card__picture-wrap" />;
  return (
    <div className="study-card__picture-wrap">
      {/* Tap the picture to see it bigger (a button, so tapping it never answers or turns the card) */}
      <button type="button" className="picture-zoom" aria-label="See the picture bigger" onClick={(e) => { e.stopPropagation(); setZoom(true); }}>
        <img
          key={list[i]}
          className={`study-card__picture ${framed ? 'is-framed' : ''}`}
          src={list[i]}
          alt="Picture to identify"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={onError}
        />
      </button>
      {createPortal(
        <AnimatePresence>
          {zoom && (
            <motion.div
              className="lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Picture"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setZoom(false)}
            >
              <motion.img
                className={`lightbox__img ${framed ? 'is-framed' : ''}`}
                src={list[i]}
                referrerPolicy="no-referrer"
                alt="Picture to identify, enlarged"
                draggable={false}
                initial={{ scale: 0.92 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
              <button type="button" className="lightbox__close" aria-label="Close" onClick={() => setZoom(false)}><Icon name="close" /></button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

