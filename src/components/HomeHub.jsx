import { useState } from 'react';
import { motion } from 'framer-motion';
import { DeckShape, Icon } from './Icon.jsx';
import { SCENES } from './Scenes.jsx';
import { READY_MADE, LIBRARY, SAMPLE_DECKS } from '../lib/sampleDeck.js';
import { deckColorVars, deckShape, SPRING } from '../styles/tokens.js';

/*
 * Home (the overview tab): ways to make a deck, decks to pick up again, sample
 * decks that never disappear, and the Help guides. The Decks tab holds the full
 * list and groups, as before.
 */

const HELP = 'https://allecards.app/help';
export const TEMPLATE_URL = 'https://allecards.app/template';

const GUIDES = [
  { scene: 'sheets', title: 'Turn a Google Sheet into flashcards', url: `${HELP}#sheets` },
  { scene: 'ai', title: 'Create flashcards with AI', url: `${HELP}#ai` },
  { scene: 'study', title: 'How studying works', url: `${HELP}#study` },
  { scene: 'home', title: 'Add Alle to your Home Screen', url: `${HELP}#home-screen` },
];

const CONTINUE_MAX = 8;

export function HomeOverview({ decks, colorMode, progressByDeck, dueByDeck, onAi, onImport, onStudy, onAddSample }) {
  // Decks to pick up again: the ones studied most recently first, then new ones (newest first).
  // Finished decks (every card seen) drop out; they live on the Decks tab.
  const continuing = decks
    .map((d, i) => ({ d, i, p: progressByDeck[d.id] || { seen: 0, total: d.cards?.length || 0, last: 0 } }))
    .filter(({ p }) => p.total > 0 && p.seen < p.total)
    .sort((a, b) => (b.p.last - a.p.last) || (b.i - a.i))
    .slice(0, CONTINUE_MAX);
  const samples = READY_MADE.filter((r) => !decks.some((d) => d.is_sample && d.title === r.title));

  return (
    <div className="hub">
      <section className="hub__section" aria-labelledby="hub-create">
        <h2 id="hub-create" className="hub__title">Create your own deck</h2>
        <div className="create-grid">
          <button type="button" className="create-card" onClick={onAi}>
            <span className="create-card__icon" style={{ background: 'var(--deck-purple)' }}><Icon name="sparkle" /></span>
            <span className="create-card__title">Create a new deck with AI</span>
            <span className="create-card__hint">Say what you want to learn. Your AI writes the cards.</span>
          </button>
          <button type="button" className="create-card" onClick={onImport}>
            <span className="create-card__icon" style={{ background: 'var(--deck-green)' }}><Icon name="sheet" /></span>
            <span className="create-card__title">Import from Google Sheets</span>
            <span className="create-card__hint">Paste the link to a sheet with two columns.</span>
          </button>
          <a className="create-card create-card--wide" href={TEMPLATE_URL} target="_blank" rel="noopener noreferrer">
            <span className="create-card__icon" style={{ background: 'var(--deck-yellow)' }}><Icon name="template" /></span>
            <span className="create-card__text">
              <span className="create-card__title">Start from a Google Sheet template</span>
              <span className="create-card__hint">Make a copy, fill in two columns, then import it.</span>
            </span>
            <Icon name="arrow" className="create-card__go" />
          </a>
        </div>
      </section>

      {continuing.length > 0 && (
        <section className="hub__section" aria-labelledby="hub-continue">
          <h2 id="hub-continue" className="hub__title">Continue learning</h2>
          <div className="hub__row">
            {continuing.map(({ d, p }) => (
              <ContinueCard key={d.id} deck={d} mode={colorMode} progress={p} due={dueByDeck[d.id] || 0} onOpen={() => onStudy(d)} />
            ))}
          </div>
        </section>
      )}

      {samples.length > 0 && (
        <section className="hub__section" aria-labelledby="hub-samples">
          <h2 id="hub-samples" className="hub__title">Add a sample deck</h2>
          <div className="hub__row">
            {samples.map((r) => <SampleTile key={r.key} sample={r} onAdd={() => onAddSample(r.key)} />)}
          </div>
        </section>
      )}

      <section className="hub__section" aria-labelledby="hub-help">
        <h2 id="hub-help" className="hub__title">Help and guides</h2>
        <div className="guides">
          {GUIDES.map((g) => <GuideCard key={g.scene} guide={g} />)}
        </div>
      </section>
    </div>
  );
}

function ContinueCard({ deck, mode, progress, due, onOpen }) {
  const { fill, deep, ink, ink2 } = deckColorVars(deck.color, mode);
  const pct = progress.total ? Math.round((progress.seen / progress.total) * 100) : 0;
  return (
    <button
      type="button"
      className="continue-card"
      style={{ '--deck-fill': fill, '--deck-deep': deep, '--deck-ink': ink, '--deck-ink-2': ink2 }}
      onClick={onOpen}
      aria-label={`${deck.title}, ${pct}% studied${due ? `, ${due} due` : ''}. Study now`}
    >
      <span className="deck__meta">{deck.front_label}<Icon name="arrow" className="deck__arrow" />{deck.back_label}</span>
      <span className="continue-card__title">{deck.title}</span>
      <span className="continue-card__progress">
        <span className="continue-card__track"><span className="continue-card__fill" style={{ width: `${pct}%` }} /></span>
        <span className="continue-card__pct">{pct}%</span>
      </span>
      <DeckShape shape={deckShape(deck)} />
    </button>
  );
}

function SampleTile({ sample, onAdd }) {
  const info = LIBRARY[sample.key] || SAMPLE_DECKS[sample.key] || {};
  const { fill, deep, ink, ink2 } = deckColorVars(sample.color);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`sample-tile ${busy ? 'is-busy' : ''}`}
      style={{ '--deck-fill': fill, '--deck-deep': deep, '--deck-ink': ink, '--deck-ink-2': ink2 }}
      disabled={busy}
      aria-label={`Add the sample deck ${sample.title}`}
      onClick={async () => { setBusy(true); try { await onAdd(); } finally { setBusy(false); } }}
    >
      {info.front_label && <span className="deck__meta">{info.front_label}<Icon name="arrow" className="deck__arrow" />{info.back_label}</span>}
      <span className="sample-tile__title">{sample.title}</span>
      <span className="sample-tile__add" aria-hidden="true">{busy ? <span className="mini-spinner" /> : <Icon name="plus" />}</span>
      <DeckShape shape={sample.shape || sample.color} />
    </button>
  );
}

function GuideCard({ guide }) {
  const Scene = SCENES[guide.scene];
  const share = async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      if (navigator.share) await navigator.share({ title: guide.title, url: guide.url });
      else { await navigator.clipboard.writeText(guide.url); }
    } catch { /* closed the share sheet */ }
  };
  return (
    <a className="guide-card" href={guide.url} target="_blank" rel="noopener noreferrer">
      <span className="guide-card__stage" aria-hidden="true"><span className="guide-card__scene"><Scene /></span></span>
      <span className="guide-card__foot">
        <span className="guide-card__title">{guide.title}</span>
        <button type="button" className="guide-card__share" aria-label={`Share the guide: ${guide.title}`} onClick={share}><Icon name="share" /></button>
      </span>
    </a>
  );
}

/** iOS-style tab bar: a floating glass capsule with the tabs, and the round + on its own. */
export function TabBar({ tab, onTab, onAdd }) {
  const TABS = [
    { key: 'home', label: 'Home', icon: 'home', active: 'homeActive' },
    { key: 'decks', label: 'Decks', icon: 'decks', active: 'decksActive' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar__tabs" role="tablist">
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} className={`tabbar__tab ${on ? 'is-active' : ''}`} onClick={() => onTab(t.key)}>
              {on && <motion.span layoutId="tabbar-pill" className="tabbar__pill" transition={SPRING.morph} />}
              <Icon name={on ? t.active : t.icon} />
              <span className="tabbar__label">{t.label}</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="tabbar__add" aria-label="Add deck" onClick={onAdd}><Icon name="plus" /></button>
    </nav>
  );
}
