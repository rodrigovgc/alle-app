import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { supabase, isConfigured } from './lib/supabase.js';
import * as api from './lib/api.js';
import { fetchDeckFromUrl } from './lib/csv.js';
import { SAMPLE_DECKS, LIBRARY } from './lib/sampleDeck.js';
import { answerMode } from './lib/srs.js';
import { pickDeckLook } from './styles/tokens.js';
import { track } from './lib/analytics.js';
import { announceSaved, SAVED_EVENT } from './lib/saved.js';
import { buildSession, collectCards, schedule } from './lib/srs.js';
import { Auth, NewPassword } from './screens/Auth.jsx';
import { handleEmailLink } from './lib/emailLink.js';
import { setPageMeta } from './lib/pageMeta.js';
import { readIntent, resolveIntent, clearIntent } from './lib/intent.js';
import { DeckPreview, GroupPreview } from './components/DeckCard.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { Home } from './screens/Home.jsx';
import { Study } from './screens/Study.jsx';
import { Done } from './screens/Done.jsx';
import { setDeckFavicon } from './lib/favicon.js';
import { Sheet, SheetActions } from './components/Sheet.jsx';
import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { Button } from './components/Button.jsx';


// Where a new deck came from, as stored on the deck (for the dashboard).
const SOURCES = { ready_made: 'ready_made', library: 'library', sheet: 'sheet', ai_or_paste: 'ai_or_paste', shared: 'shared' };

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [linkNotice, setLinkNotice] = useState('');
  const [intentTitle, setIntentTitle] = useState('');
  useEffect(() => {
    const intent = readIntent();
    if (!intent) return;
    // Shared decks can only be read once signed in, so name ready-made ones only.
    if (intent.type === 'share' || intent.type === 'group') { setIntentTitle(intent.type === 'group' ? '__group__' : '__shared__'); return; }
    resolveIntent(intent).then((r) => r && setIntentTitle(r.title)).catch(() => {});
  }, []);
  const [choosingPassword, setChoosingPassword] = useState(false);

  useEffect(() => {
    if (!isConfigured) { setUser(null); return undefined; }
    let alive = true;
    (async () => {
      // An email link? Finish it first (confirm, change email or reset password).
      const link = await handleEmailLink();
      if (!alive) return;
      if (link?.error) {
        setLinkNotice('That link has expired or was already used. Sign in, or ask for a new email.');
      } else if (link?.type === 'recovery') {
        setChoosingPassword(true);
      }
      const { data } = await supabase.auth.getSession();
      if (alive) setUser(data.session?.user ?? null);
    })();
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, []);

  if (user === undefined) return <div className="boot" aria-busy="true" />;
  if (!user) {
    return (
      <Auth notice={linkNotice || (
        intentTitle === '__shared__' ? 'Sign in or create an account to add the deck someone shared with you.'
          : intentTitle === '__group__' ? 'Sign in or create an account to add the decks someone shared with you.'
          : intentTitle ? `Sign in or create an account to add “${intentTitle}” to your decks.`
            : '')} />
    );
  }
  if (choosingPassword) return <NewPassword onDone={() => setChoosingPassword(false)} />;
  return <Library key={user.id} user={user} onUser={setUser} />;
}

function Library({ user, onUser }) {
  const ready = true;
  const [decks, setDecks] = useState([]);
  const [groups, setGroups] = useState(null);   // null: groups not set up in the database yet
  const groupsRef = useRef(null);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  const sortGroups = (gs) => [...gs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreenNow] = useState({ name: 'home' });
  // Screen changes cross-fade with the browser's View Transitions: the old
  // screen stays painted until the new one is ready, so nothing blinks. Browsers
  // without it (or with reduced motion) just swap instantly.
  const setScreen = useCallback((next) => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduce) { setScreenNow(next); return; }
    document.startViewTransition(() => { flushSync(() => setScreenNow(next)); });
  }, []);
  const [caughtUp, setCaughtUp] = useState(null); // decks to practise anyway
  const [notice, setNotice] = useState('');
  // "✓ Changes saved" after any change that saves on its own (see lib/saved.js)
  const [savedAt, setSavedAt] = useState(0);
  useEffect(() => {
    const on = () => setSavedAt(Date.now());
    window.addEventListener(SAVED_EVENT, on);
    return () => window.removeEventListener(SAVED_EVENT, on);
  }, []);
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = setTimeout(() => setSavedAt(0), 1800);
    return () => clearTimeout(t);
  }, [savedAt]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // Save a new deck. If the sign-in has lapsed, keep the deck on this device,
  // ask to sign in again, and save it straight after.
  const saveNewDeck = useCallback(async (deck, source) => {
    try {
      // A new deck stays out of the groups (it shows under "Recently added" at the top of
      // Decks) until it's moved into one. The very first deck starts the first group.
      let groupId = deck.group_id;
      const gs = groupsRef.current;
      if (!groupId && gs && !gs.length) {
        const first = await api.createGroup({ title: 'My study decks', position: 1 });
        groupsRef.current = [first];
        setGroups([first]);
        groupId = first.id;
      }
      const created = await api.createDeck({ ...deck, ...(groupId ? { group_id: groupId } : {}), source: SOURCES[source] ?? deck.source ?? null });
      setDecks((all) => [...all, created]);
      track('deck_added', { source, lang: deck.lang });
      return created;
    } catch (e) {
      if (e instanceof api.SignedOutError) {
        try { localStorage.setItem('alle-pending-deck', JSON.stringify(deck)); } catch { /* full */ }
        sessionStorage.setItem('alle-auth-notice', `Your sign-in expired. Sign in again and we’ll save “${deck.title}” for you.`);
        await supabase.auth.signOut();
        return null;
      }
      throw e;
    }
  }, []);

  const addReadyMade = async (key, groupId = null) => {
    const into = groupId ? { group_id: groupId } : {};
    try {
      const sample = SAMPLE_DECKS[key];
      if (sample) {
        // Keep the sample's own colour if it's free; otherwise a free one.
        await saveNewDeck({ ...sample, ...pickDeckLook(decks), ...into }, 'ready_made');
        return;
      }
      // A library deck from the website: read its published sheet.
      const lib = LIBRARY[key];
      if (!lib) return;
      const parsed = await fetchDeckFromUrl(lib.csv_url);
      await saveNewDeck({
        ...lib,
        front_label: parsed.frontLabel || lib.front_label,
        back_label: parsed.backLabel || lib.back_label,
        cards: parsed.cards,
        answer_mode: 'choice',
        is_sample: true,
        ...pickDeckLook(decks),
        ...into,
      }, 'library');
    } catch (e) { setError(api.friendlyError(e)); }
  };

  useEffect(() => { setPageMeta('decks'); }, []);

  // "Opened the app today": once a day per person, for last-active and active days.
  useEffect(() => {
    const key = `alle-open:${user.id}`;
    const today = new Date().toISOString().slice(0, 10);
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { /* storage off */ }
    track('app_open', {});
  }, [user.id]);

  // First-run tour: once per account (saved to the account, so other devices skip it).
  const [touring, setTouring] = useState(() => {
    if (user.user_metadata?.onboarded) return false;
    try { return localStorage.getItem(`alle-onboarded:${user.id}`) !== '1'; } catch { return true; }
  });
  function finishTour() {
    setTouring(false);
    try { localStorage.setItem(`alle-onboarded:${user.id}`, '1'); } catch { /* storage off */ }
    if (!user.user_metadata?.onboarded) {
      supabase.auth.updateUser({ data: { onboarded: true } }).then(({ data }) => data?.user && onUser(data.user)).catch(() => {});
    }
  }

  // Opened from a share or "add" link: offer to add that deck.
  const [incoming, setIncoming] = useState(null);
  useEffect(() => {
    const intent = readIntent();
    if (!intent) return;
    resolveIntent(intent).then((r) => {
      if (r) setIncoming(r);
      else { clearIntent(); setError('That deck link isn’t available anymore.'); }
    });
  }, []);
  async function acceptIncoming() {
    const r = incoming;
    setIncoming(null); clearIntent();
    try {
      if (r.kind === 'ready') { await addReadyMade(r.key); return; }
      if (r.kind === 'group') {
        const position = Math.max(0, ...(groups || []).map((x) => x.position ?? 0)) + 1;
        const g = await api.createGroup({ title: r.title, position });
        setGroups((all) => [...(all || []), g]);
        let soFar = [...decks];
        for (const d of r.decks) {
          const created = await saveNewDeck({
            title: d.title, front_label: d.front_label, back_label: d.back_label, lang: d.lang,
            csv_url: d.csv_url, cards: d.cards, answer_mode: d.answer_mode ?? 'choice', group_id: g.id,
            ...pickDeckLook(soFar),
          }, 'shared');
          if (created) soFar = [...soFar, created];
        }
        setNotice(`Added “${r.title}” with ${r.decks.length} ${r.decks.length === 1 ? 'deck' : 'decks'}.`);
        return;
      }
      const d = r.deck;
      const created = await saveNewDeck({
        title: d.title, front_label: d.front_label, back_label: d.back_label, lang: d.lang,
        csv_url: d.csv_url, cards: d.cards, answer_mode: d.answer_mode ?? 'choice',
        ...pickDeckLook(decks),
      }, 'shared');
      if (created) setNotice(`Added “${created.title}” to your decks.`);
    } catch (e) { setError(api.friendlyError(e)); }
  }

  // A deck kept safe while signed out: save it now.
  useEffect(() => {
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem('alle-pending-deck') || 'null'); } catch { /* bad data */ }
    if (!pending) return;
    localStorage.removeItem('alle-pending-deck');
    saveNewDeck({ ...pending, user_id: undefined }, 'restored')
      .then((d) => d && setNotice(`Saved “${d.title}”, the deck you were making.`))
      .catch((e) => setError(api.friendlyError(e)));
  }, [saveNewDeck]);
  const [error, setError] = useState('');
  const refreshed = useRef(false);

  const prefs = user.user_metadata || {};
  const colorMode = prefs.color_mode === 'monochrome' ? 'monochrome' : 'colorful';

  // Tab icon takes the colour of the deck being studied (one deck only;
  // mixed sessions and monochrome keep the normal lime icon).
  const studyDeckIds = screen.name === 'study' ? [...new Set(screen.cards.map((c) => c.deckId))] : [];
  const studyColor = colorMode === 'colorful' && studyDeckIds.length === 1
    ? decks.find((d) => d.id === studyDeckIds[0])?.color ?? null
    : null;
  useEffect(() => {
    setDeckFavicon(studyColor);
    return () => setDeckFavicon(null);
  }, [studyColor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let [d, g] = await Promise.all([api.listDecks(), api.listGroups().catch(() => null)]);
      // Every deck lives in a group, and there is always at least one group.
      if (g && d.length) {
        if (!g.length) g = [await api.createGroup({ title: 'My study decks', position: 1 })];
        // Decks whose group was deleted elsewhere go back to "Recently added" (no group).
        const ids = new Set(g.map((x) => x.id));
        d = d.map((x) => (x.group_id && !ids.has(x.group_id) ? { ...x, group_id: null } : x));
      }
      setDecks(d);
      setGroups(g);
      setProgress(await api.listProgress(d.map((x) => x.id)));
      return d;
    } catch (e) {
      setError(api.friendlyError(e));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Load, then quietly re-read each linked sheet so edits in Google Sheets show up.
  useEffect(() => {
    if (!ready) return;
    load().then(async (d) => {
      if (refreshed.current) return;
      refreshed.current = true;
      for (const deck of d.filter((x) => x.csv_url)) {
        try {
          const fresh = await fetchDeckFromUrl(deck.csv_url);
          const changed =
            JSON.stringify(fresh.cards) !== JSON.stringify(deck.cards) ||
            fresh.frontLabel !== deck.front_label || fresh.backLabel !== deck.back_label;
          if (changed) {
            const updated = await api.updateDeck(deck.id, {
              cards: fresh.cards, front_label: fresh.frontLabel, back_label: fresh.backLabel,
            });
            setDecks((all) => all.map((x) => (x.id === updated.id ? updated : x)));
          }
        } catch { /* offline or unpublished: keep the cached copy */ }
      }
    });
  }, [ready, load]);

  const allCards = useMemo(() => collectCards(decks, progress), [decks, progress]);

  const dueByDeck = useMemo(() => {
    const now = new Date();
    const out = {};
    for (const c of allCards) {
      if (c.progress && new Date(c.progress.due_at) <= now) out[c.deckId] = (out[c.deckId] || 0) + 1;
    }
    return out;
  }, [allCards]);

  // For "Continue learning" on Home: how much of each deck has been studied, and when last
  const progressByDeck = useMemo(() => {
    const out = {};
    for (const c of allCards) {
      const p = (out[c.deckId] ||= { seen: 0, total: 0, last: 0 });
      p.total += 1;
      if (c.progress) {
        p.seen += 1;
        const t = Date.parse(c.progress.last_reviewed_at || '') || 0;
        if (t > p.last) p.last = t;
      }
    }
    return out;
  }, [allCards]);

  function start(deckIds, { mix = false, practice = false } = {}) {
    const pool = allCards.filter((c) => deckIds.includes(c.deckId));
    const cards = buildSession(pool, { mix, practice });
    if (!cards.length) { setCaughtUp({ deckIds, mix }); return; }
    setCaughtUp(null);
    answered.current = 0;
    track('session_started', { cards: cards.length, decks: deckIds.length, mix });
    setScreen({ name: 'study', cards, id: Date.now() });
  }
  // Study time for the dashboard: seconds since the session started, capped so
  // a session left open in the background doesn't count as hours of study.
  const answered = useRef(0);
  const sessionSeconds = () => Math.min(45 * 60, Math.round((Date.now() - (screen.id || Date.now())) / 1000));

  const review = useCallback((card, verdict) => {
    answered.current += 1;
    const row = {
      user_id: user.id,
      deck_id: card.deckId,
      card_hash: card.hash,
      ...schedule(card.progress, verdict),
    };
    setProgress((all) => [
      ...all.filter((p) => !(p.deck_id === row.deck_id && p.card_hash === row.card_hash)),
      row,
    ]);
    api.saveProgress(row).catch((e) => setError(`Progress didn’t save: ${e.message}`));
  }, [user.id]);

  async function setPrefs(patch) {
    onUser({ ...user, user_metadata: { ...prefs, ...patch } }); // optimistic
    try { onUser(await api.updatePrefs(patch)); announceSaved(); } catch (e) { setError(api.friendlyError(e)); }
  }


  let view;
  if (screen.name === 'study') {
    view = (
      <Study
        cards={screen.cards}
        onReview={review}
        onExit={() => {
          track('session_left', { total: answered.current, of: screen.cards.length, duration_s: sessionSeconds() });
          setScreen({ name: 'home' });
        }}
        onFinish={(score) => {
          track('session_finished', { total: score.total, correct: score.correct, duration_s: sessionSeconds() });
          setScreen({ name: 'done', ...score });
        }}
      />
    );
  } else if (screen.name === 'done') {
    view = <Done correct={screen.correct} total={screen.total} onDone={() => setScreen({ name: 'home' })} />;
  } else {
    view = (
      <Home
        decks={decks}
        loading={loading || !ready}
        dueByDeck={dueByDeck}
        progressByDeck={progressByDeck}
        colorMode={colorMode}
        onAddSample={addReadyMade}
        onColorMode={(mode) => setPrefs({ color_mode: mode })}
        onStudyDeck={(deck) => start([deck.id])}
        onShuffle={(ids) => start(ids && ids.length ? ids : decks.map((d) => d.id), { mix: true })}
        onAddDeck={async (deck) => {
          // New decks start as multiple choice (easier to begin with).
          const created = await saveNewDeck({ answer_mode: 'choice', ...deck }, deck.csv_url ? 'sheet' : 'ai_or_paste');
          if (created && answerMode(created) === 'choice') {
            setNotice('This deck uses multiple choice. You can switch to typing anytime in Edit deck.');
          }
        }}
        onUpdateDeck={async (id, patch) => {
          await api.updateDeck(id, patch);
          // Merge the change into what's on screen (keeps ready-made decks current).
          setDecks((all) => all.map((d) => (d.id === id ? { ...d, ...patch } : d)));
          announceSaved();
        }}
        onRemoveDeck={async (id) => {
          await api.removeDeck(id);
          setDecks((all) => all.filter((d) => d.id !== id));
          setProgress((all) => all.filter((p) => p.deck_id !== id));
        }}
        onRefresh={load}
        onHelp={() => setTouring(true)}
        onShareDeck={async (deck) => {
          const r = await api.shareDeck(deck);
          setDecks((all) => all.map((d) => (d.id === deck.id ? { ...d, share_id: r.id } : d)));
          track('deck_shared', {});
          return r;
        }}
        onStopSharing={async (id) => {
          await api.stopSharing(id);
          setDecks((all) => all.map((d) => (d.id === id ? { ...d, share_id: null } : d)));
        }}
        onRainbow={(only) => {
          // Repaint decks in order, one after another, so it ripples down the list.
          const RAINBOW = ['yellow', 'green', 'blue', 'red', 'purple', 'lime', 'pink'];
          if (colorMode === 'monochrome') setPrefs({ color_mode: 'colorful' });
          (only ? decks.filter((d) => only.includes(d.id)) : decks).forEach((deck, i) => {
            const color = RAINBOW[i % RAINBOW.length];
            if (deck.color === color) return;
            setTimeout(() => {
              setDecks((all) => all.map((d) => (d.id === deck.id ? { ...d, color } : d)));
            }, i * 90);
            api.updateDeck(deck.id, { color }).catch(() => {});
          });
          announceSaved();
          track('rainbow_used', {});
        }}
        groups={groups}
        onCreateGroup={async (title, after) => {
          // Right after the group it was created from, or at the end
          const list = sortGroups(groups || []);
          const i = after ? list.findIndex((x) => x.id === after) : -1;
          const position = i >= 0
            ? ((list[i].position ?? 0) + (list[i + 1]?.position ?? (list[i].position ?? 0) + 2)) / 2
            : Math.max(0, ...list.map((x) => x.position ?? 0)) + 1;
          const g = await api.createGroup({ title, position });
          setGroups((all) => [...(all || []), g]);
          track('group_created', {});
          return g;
        }}
        onUpdateGroup={async (id, patch) => {
          setGroups((all) => (all || []).map((g) => (g.id === id ? { ...g, ...patch } : g)));
          try {
            await api.updateGroup(id, patch);
            // Opening/closing a group isn't a change worth announcing
            if (Object.keys(patch).some((k) => k !== 'collapsed')) announceSaved();
          } catch (e) { setError(api.friendlyError(e)); }
        }}
        onMoveGroup={async (id, delta) => {
          // Swap places with the neighbouring group
          const sorted = sortGroups(groups || []);
          const i = sorted.findIndex((g) => g.id === id); const j = i + delta;
          if (i < 0 || j < 0 || j >= sorted.length) return;
          [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
          const renum = sorted.map((g, k) => ({ ...g, position: k + 1 }));
          setGroups(renum);
          try { await Promise.all(renum.map((g) => api.updateGroup(g.id, { position: g.position }))); announceSaved(); } catch (e) { setError(api.friendlyError(e)); }
        }}
        onDeleteGroup={async (id, { withDecks = false, moveTo = null } = {}) => {
          try {
            if (withDecks) {
              const doomed = decks.filter((d) => d.group_id === id).map((d) => d.id);
              for (const deckId of doomed) await api.removeDeck(deckId);
              setDecks((all) => all.filter((d) => !doomed.includes(d.id)));
              setProgress((all) => all.filter((p) => !doomed.includes(p.deck_id)));
            } else if (moveTo) {
              // Keep the decks: they move to another group first
              const moving = decks.filter((d) => d.group_id === id);
              await Promise.all(moving.map((d) => api.updateDeck(d.id, { group_id: moveTo })));
              setDecks((all) => all.map((d) => (d.group_id === id ? { ...d, group_id: moveTo } : d)));
            }
            await api.removeGroup(id);
            setGroups((all) => (all || []).filter((g) => g.id !== id));
          } catch (e) { setError(api.friendlyError(e)); }
        }}
        onReorderGroups={async (ordered) => {
          const renum = ordered.map((g, k) => ({ ...g, position: k + 1 }));
          setGroups(renum);
          try { await Promise.all(renum.map((g) => api.updateGroup(g.id, { position: g.position }))); announceSaved(); } catch (e) { setError(api.friendlyError(e)); }
        }}
        onDecksChange={async (ordered) => {
          // A deck dragged into another group, out of one, or to a new place
          const before = Object.fromEntries(decks.map((d) => [d.id, d.group_id || null]));
          setDecks(ordered);
          try {
            await Promise.all(ordered.filter((d) => (d.group_id || null) !== before[d.id]).map((d) => api.updateDeck(d.id, { group_id: d.group_id })));
            setDecks(await api.saveOrder(ordered));
            announceSaved();
          } catch (e) { setError(api.friendlyError(e)); }
        }}
        onShareGroup={async (group) => {
          const r = await api.shareGroup(group);
          setGroups((all) => (all || []).map((g) => (g.id === group.id ? { ...g, share_id: r.id } : g)));
          track('group_shared', {});
          return r;
        }}
        onStopSharingGroup={async (id) => {
          await api.stopSharingGroup(id);
          setGroups((all) => (all || []).map((g) => (g.id === id ? { ...g, share_id: null } : g)));
        }}
        onMoveDecks={async (ids, groupId) => {
          setDecks((all) => all.map((d) => (ids.includes(d.id) ? { ...d, group_id: groupId } : d)));
          await Promise.all(ids.map((id) => api.updateDeck(id, { group_id: groupId })));
          announceSaved();
        }}
        onMoveDeck={async (deckId, groupId) => {
          setDecks((all) => all.map((d) => (d.id === deckId ? { ...d, group_id: groupId } : d)));
          try { await api.updateDeck(deckId, { group_id: groupId }); announceSaved(); } catch (e) {
            setError(/group_id/.test(api.rawError(e)) ? 'Groups need one database update. Run supabase/010_groups.sql in Supabase.' : api.friendlyError(e));
          }
        }}
        onReorder={async (ordered) => {
          setDecks(ordered); // show the new order straight away
          try {
            setDecks(await api.saveOrder(ordered));
            announceSaved();
          } catch (e) {
            setError(/position/.test(api.rawError(e))
              ? 'Saving the order needs one database update. Run supabase/004_position.sql in Supabase.'
              : e.message);
          }
        }}
        onResetProgress={async (id) => {
          try {
            await api.resetProgress(id);
            setProgress((all) => all.filter((p) => p.deck_id !== id));
          } catch (e) { setError(api.friendlyError(e)); }
        }}
        onSignOut={() => supabase.auth.signOut()}
        user={user}
        onUserUpdated={onUser}
      />
    );
  }

  return (
    <>
      {/* One screen mounted at a time; the change cross-fades through a view
          transition (see setScreen). The previous screen is never kept around,
          so finishing a session can't leave two screens fighting (which wedged
          the Done button). */}
      <div key={screen.name === 'study' ? `study-${screen.id}` : screen.name} className="screen">
        <ErrorBoundary key={screen.name} onReset={() => setScreen({ name: 'home' })}>
          {view}
        </ErrorBoundary>
      </div>

      <Sheet open={!!caughtUp} onClose={() => setCaughtUp(null)} title="All caught up" variant="dialog">
        <div className="sheet__body">
          <p className="sheet__text">
            Nothing is due right now and there are no new cards left. You can review the cards coming up next anyway.
          </p>
          <SheetActions>
            <Button onClick={() => start(caughtUp.deckIds, { mix: caughtUp.mix, practice: true })}>
              Practise anyway
            </Button>
            <Button variant="secondary" onClick={() => setCaughtUp(null)}>Not now</Button>
          </SheetActions>
        </div>
      </Sheet>

      {touring && <Onboarding onDone={finishTour} />}

      <Sheet open={!!incoming && !touring} onClose={() => { setIncoming(null); clearIntent(); }} title={incoming?.kind === 'group' ? 'Add these decks?' : 'Add this deck?'} variant="dialog">
        {incoming && (
          <div className="sheet__body">
            {incoming.kind === 'group'
              ? <GroupPreview title={incoming.title} decks={incoming.decks} existing={decks} />
              : (
                <DeckPreview deck={{
                  title: incoming.title,
                  front_label: incoming.deck?.front_label || '',
                  back_label: incoming.deck?.back_label || '',
                  ...pickDeckLook(decks),   // the colour it will really get
                  cards: incoming.deck?.cards || [],
                }} />
              )}
            <p className="sheet__text">
              {incoming.kind === 'shared'
                ? 'Someone shared this deck with you. Add a copy to your decks to start studying it.'
                : incoming.kind === 'group'
                  ? 'Someone shared this group with you. Add it to get your own copy of every deck in it, in a new group.'
                  : 'Add this ready-made deck to your decks.'}
            </p>
            <SheetActions>
              <Button onClick={acceptIncoming}>{incoming.kind === 'group' ? `Add ${incoming.decks.length} ${incoming.decks.length === 1 ? 'deck' : 'decks'}` : 'Add to my decks'}</Button>
              <Button variant="secondary" onClick={() => { setIncoming(null); clearIntent(); }}>Not now</Button>
            </SheetActions>
          </div>
        )}
      </Sheet>

      {error && (
        <div className="toast" role="alert" onClick={() => setError('')}>
          {error}
        </div>
      )}
      {!error && !notice && savedAt > 0 && (
        <div className="toast toast--notice" role="status">✓ Changes saved</div>
      )}
      {!error && notice && (
        <div className="toast toast--notice" role="status" onClick={() => setNotice('')}>
          {notice}
        </div>
      )}
    </>
  );
}
