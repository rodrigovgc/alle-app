import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Logo, Icon, DeckShape } from '../components/Icon.jsx';
import { Button, IconButton } from '../components/Button.jsx';
import { DeckCard, DeckPreview } from '../components/DeckCard.jsx';
import { Menu } from '../components/Menu.jsx';
import { GroupedBoard } from '../components/GroupedBoard.jsx';
import { AutoInput } from '../components/AutoInput.jsx';
import { Sheet, Field, SheetActions } from '../components/Sheet.jsx';
import { AiBuilder } from '../components/AiBuilder.jsx';
import { usePullToRefresh } from '../lib/usePullToRefresh.js';
import { initials, fullName } from '../lib/person.js';
import { ReorderList } from '../components/ReorderList.jsx';
import { SortableDecks } from '../components/SortableDecks.jsx';
import { useMediaQuery } from '../lib/useMediaQuery.js';
import { Segmented } from '../components/Segmented.jsx';
import { Account, ThemeSettings } from '../components/Account.jsx';
import { READY_MADE } from '../lib/sampleDeck.js';
import { HomeOverview, TabBar, Sidebar, useSamplesHidden } from '../components/HomeHub.jsx';
import { answerMode } from '../lib/srs.js';
import { fetchSheetName, fetchDeckFromUrl } from '../lib/csv.js';
import { rawError } from '../lib/api.js';
import { LANGUAGES, inferLang } from '../lib/speech.js';
import { VoicePicker } from '../components/VoicePicker.jsx';
import { DECK_COLORS, DECK_COLOR_LABELS, DECK_SHAPES, NO_COLOR, SPRING, deckColorVars, deckShape, pickDeckLook, tokenNumber } from '../styles/tokens.js';

const HELP_URL = 'https://allecards.app/help';

export function Home({
  decks, loading, dueByDeck, progressByDeck = {}, colorMode,
  onAddSample, onColorMode, onStudyDeck, onShuffle,
  onAddDeck, onUpdateDeck, onRemoveDeck, onResetProgress, onReorder, onRainbow, onRefresh, onSignOut, user, onUserUpdated,
  onShareDeck, onStopSharing, onHelp, onMoveDecks,
  groups = [], onCreateGroup, onUpdateGroup, onMoveGroup, onDeleteGroup, onMoveDeck,
  onReorderGroups, onDecksChange, onShareGroup, onStopSharingGroup,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheetState] = useState(null); // { type, deck? }
  const [samplesHidden, setSamplesHidden] = useSamplesHidden();
  // Opening the ready-made library from + brings the sample decks back on Home
  const setSheet = (next) => { if (next?.type === 'library') setSamplesHidden(false); setSheetState(next); };
  // Two tabs: Home (overview, ways to start) and Decks (the list and groups).
  const [tab, setTabState] = useState(() => {
    try { return sessionStorage.getItem('alle-tab') || 'home'; } catch { return 'home'; }
  });
  const setTab = (t) => {
    setTabState(t);
    try { sessionStorage.setItem('alle-tab', t); } catch { /* private mode */ }
    window.scrollTo({ top: 0, behavior: t === tab ? 'smooth' : 'auto' });
  };
  const headerRef = useRef(null);
  const shellPill = useMemo(() => tokenNumber('--size-search-pill', 98), []);
  const [shellFull, setShellFull] = useState(shellPill);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const gutter = tokenNumber('--gutter', 16);
    const measure = () => setShellFull(el.clientWidth - gutter * 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function openSearch() { setSearching(true); if (tab !== 'decks') setTab('decks'); }
  function closeSearch() { setSearching(false); setQuery(''); }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decks;
    return decks.filter((d) =>
      [d.title, d.front_label, d.back_label].some((s) => s?.toLowerCase().includes(q)));
  }, [decks, query]);

  // A new deck made from an empty group's "Add a new deck" goes into that group
  const [addTo, setAddTo] = useState(null);
  const close = () => { setSheet(null); setAddTo(null); };
  // A deck you made yourself shows up on the Decks tab, so you see where it went
  const addDeck = async (deck) => { const r = await onAddDeck(addTo ? { ...deck, group_id: addTo } : deck); setTab('decks'); return r; };
  const addSample = (key) => onAddSample(key, addTo);
  const addToTitle = addTo ? groups?.find((g) => g.id === addTo)?.title : null;
  // A mouse or trackpad: decks can be dragged into place directly.
  const canDrag = useMediaQuery('(hover: hover) and (pointer: fine)');
  // Desktop: a sidebar replaces the tab bar
  const wide = useMediaQuery('(min-width: 1024px)');
  const goToGroup = (g) => {
    if (searching) closeSearch();
    setTab('decks');
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`group-${g.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  };
  // Reorder mode: a working copy of the order, saved on Done.
  const [order, setOrder] = useState(null);
  const reordering = order !== null;
  const renderDeck = (deck) => (
    <DeckCard
      deck={deck}
      mode={colorMode}
      due={dueByDeck[deck.id] || 0}
      onOpen={() => onStudyDeck(deck)}
      onUpdateUrl={() => setSheet({ type: 'url', deck })}
      onCustomize={() => setSheet({ type: 'cover', deck })}
      onShare={() => setSheet({ type: 'share', deck })}
      onMoveToGroup={() => setSheet({ type: 'move', deck })}
      onResetProgress={() => setSheet({ type: 'reset', deck })}
      onRemove={() => setSheet({ type: 'remove', deck })}
    />
  );
  // Groups: shown as sections when not searching or reordering
  const groupsOn = Array.isArray(groups);   // false until supabase/010_groups.sql has run
  const sortedGroups = [...(groups || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const grouped = !query && !reordering && groupsOn && sortedGroups.length > 0 && decks.length > 0;
  const groupIds = new Set(sortedGroups.map((g) => g.id));
  const ungrouped = decks.filter((d) => !d.group_id || !groupIds.has(d.group_id));
  // Reorder decks inside one group (or the ungrouped ones) and keep the rest in place
  const reorderSubset = (subsetNew) => {
    const ids = new Set(subsetNew.map((d) => d.id)); let k = 0;
    onReorder(decks.map((d) => (ids.has(d.id) ? subsetNew[k++] : d)));
  };
  const ptr = usePullToRefresh(onRefresh, !sheet && !reordering);
  async function finishReorder() {
    const { list, from } = order;
    setOrder(null);
    if (list.some((d, i) => d.id !== from[i]?.id)) reorderSubset(list);
  }
  const startReorder = (list, title) => { setSearching(false); setQuery(''); setOrder({ list, from: list, title }); };
  // Ready-made decks the user hasn't added yet; added ones are hidden.
  const remainingReadyMade = READY_MADE.filter((r) => !decks.some((d) => d.is_sample && d.title === r.title));

  return (
    <>
    {wide && !reordering && (
      <Sidebar
        tab={searching ? 'decks' : tab}
        onTab={(t) => { if (searching) closeSearch(); setTab(t); }}
        groups={groupsOn ? sortedGroups : []}
        onGroup={goToGroup}
        onTour={onHelp}
        onAccount={() => setSheet({ type: 'account' })}
        onTheme={() => setSheet({ type: 'theme' })}
        userName={fullName(user) || user.email}
        userInitials={initials(user)}
      />
    )}
    <main className={`home ${wide ? 'home--side' : ''}`} style={ptr.pull ? { transform: `translateY(${ptr.pull}px)`, transition: 'none' } : undefined}>
      {(ptr.pull > 0 || ptr.refreshing) && (
        <div className="ptr" style={{ top: `${-ptr.pull + 12}px`, opacity: ptr.progress }} aria-live="polite">
          <span className={`ptr__spinner ${ptr.refreshing ? 'is-spinning' : ''}`} style={{ transform: `rotate(${ptr.progress * 270}deg)` }} />
          {ptr.refreshing && <span className="visually-hidden">Refreshing</span>}
        </div>
      )}
      {wide ? (
        /* Desktop: search lined up with the cards, New deck on the right; account and theme live in the sidebar */
        <header className="home__header home__header--wide">
          <label className={`wide-search ${query ? 'has-text' : ''}`}>
            <Icon name="search" className="wide-search__icon" />
            <input
              type="search"
              placeholder="Search decks"
              aria-label="Search decks"
              value={query}
              enterKeyHint="search"
              onChange={(e) => { const v = e.target.value; setQuery(v); setSearching(Boolean(v.trim())); }}
              onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
            />
            {query && <button type="button" className="search__cancel" onClick={closeSearch}>Cancel</button>}
          </label>
          <div className="home__header-end">
            <Button icon="plus" onClick={() => setSheet({ type: 'choose' })}>New deck</Button>
          </div>
        </header>
      ) : (
      <header className="home__header" ref={headerRef}>
        {/* Logo and + only fade: nothing is scaled or moved, so nothing distorts */}
        <motion.div
          className="home__logo"
          initial={false}
          animate={{ opacity: searching ? 0 : 1 }}
          transition={{ duration: searching ? 0.12 : 0.2, delay: searching ? 0 : 0.12 }}
          aria-hidden={searching}
        >
          <button type="button" className="home__logo-btn" aria-label="Alle, go to Home" onClick={() => { closeSearch(); setTab('home'); }}><Logo /></button>
        </motion.div>

        <div className="home__actions">
          <div className="pill-slot" aria-hidden="true" />
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            className="menu--home"
            items={[
              ...(!groupsOn && decks.length > 1 ? [
                { label: 'Reorder decks', icon: 'sort', onSelect: () => startReorder(decks, 'Reorder decks') },
                { label: 'Repaint decks', icon: 'repaint', onSelect: () => { setSearching(false); setQuery(''); onRainbow(); } },
              ] : []),
              { label: 'Account', icon: 'person', onSelect: () => setSheet({ type: 'account' }) },
              { label: 'Theme', icon: 'theme', onSelect: () => setSheet({ type: 'theme' }) },
              { label: 'Quick tutorial', icon: 'help', onSelect: () => onHelp() },
              { label: 'Help and guides', icon: 'article', onSelect: () => window.open(HELP_URL, '_blank', 'noopener') },
            ]}
          />
        </div>

        {/* One shell: its real width grows from the pill to the full row. Width
            changes reflow the contents instead of stretching them. */}
        <motion.div
          className={`search-shell ${searching ? 'is-open' : ''}`}
          initial={false}
          animate={{ width: searching ? shellFull : shellPill }}
          transition={SPRING.morph}
        >
          <AnimatePresence initial={false}>
            {searching ? (
              <motion.div
                key="field"
                className="search__content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.08, duration: 0.18 } }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <Icon name="search" className="search__icon" />
                <input
                  className="search__input"
                  type="search"
                  placeholder="Search decks"
                  aria-label="Search decks"
                  value={query}
                  autoFocus
                  enterKeyHint="search"
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                />
                <button type="button" className="search__cancel" onClick={closeSearch}>Cancel</button>
              </motion.div>
            ) : (
              <motion.div
                key="pill"
                className="pill__content"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.1, duration: 0.18 } }}
                exit={{ opacity: 0, transition: { duration: 0.08 } }}
              >
                <button type="button" className="pill__btn" aria-label="Search decks" onClick={openSearch}>
                  <Icon name="search" />
                </button>
                <button
                  type="button"
                  className="pill__btn pill__avatar"
                  aria-label={`Menu for ${fullName(user) || user.email}`}
                  title={fullName(user) ? `${fullName(user)} · ${user.email}` : user.email}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(true)}
                >
                  <span className="avatar" aria-hidden="true">{initials(user)}</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </header>
      )}

      {tab === 'home' && !searching && !reordering && (
        <>
          <h1 className="visually-hidden">Home</h1>
          <HomeOverview
            decks={decks}
            colorMode={colorMode}
            progressByDeck={progressByDeck}
            dueByDeck={dueByDeck}
            onAi={() => setSheet({ type: 'ai' })}
            onImport={() => setSheet({ type: 'add' })}
            onStudy={onStudyDeck}
            onAddSample={(key) => onAddSample(key, null)}
            samplesHidden={samplesHidden}
            onSamplesHidden={setSamplesHidden}
          />
        </>
      )}

      {(tab === 'decks' || searching || reordering) && <>
      {grouped ? <h1 className="visually-hidden">My study decks</h1> : (loading || decks.length > 0) && (
        <div className="home__title-row">
          <h1 className="home__title">{reordering ? order.title : 'My study decks'}</h1>
          {reordering && <button type="button" className="text-btn home__done" onClick={finishReorder}>Done</button>}
        </div>
      )}

      <section className={grouped ? 'deck-board' : 'deck-list'} aria-busy={loading}>
        {loading && !decks.length && <div className="deck deck--skeleton" aria-hidden="true" />}
        {!loading && !decks.length && (
          <div className="start" aria-label="Get started">
            <section className="start-tile">
              <h2 className="start-tile__title">Create your own deck</h2>
              <p className="start-tile__text">Import cards from Google Sheets or create a new deck with AI.</p>
              <CreateChoices onAi={() => setSheet({ type: 'ai' })} onPaste={() => setSheet({ type: 'paste' })} onImport={() => setSheet({ type: 'add' })} />
            </section>
            <section className="start-tile">
              <h2 className="start-tile__title">Try a sample deck</h2>
              <p className="start-tile__text">Pick a deck to see how studying works.</p>
              <div className="start-tile__samples">
                {READY_MADE.map((r) => (
                  <SampleCard key={r.key} title={r.title} color={r.color} shape={r.shape} onClick={() => addSample(r.key)} />
                ))}
              </div>
            </section>
          </div>
        )}
        {!!decks.length && !visible.length && (
          <p className="empty__body">No decks match “{query}”.</p>
        )}
        {reordering && <ReorderList decks={order.list} mode={colorMode} onChange={(list) => setOrder((o) => ({ ...o, list }))} />}
        {grouped && (
          <GroupedBoard
            groups={sortedGroups}
            decks={decks}
            renderDeck={renderDeck}
            canDragDecks={canDrag}
            onToggle={(g) => onUpdateGroup(g.id, { collapsed: !g.collapsed })}
            onRename={(g, title) => onUpdateGroup(g.id, { title })}
            onReorderGroups={onReorderGroups}
            onDecksChange={onDecksChange}
            emptyFor={(g) => {
              const others = decks.filter((d) => d.group_id !== g.id).length;
              return (
                <>
                  <p className="group__empty-title">This group is empty</p>
                  <p className="group__empty-text">
                    {canDrag ? 'Drag a deck here, or:' : 'Add a deck to it:'}
                  </p>
                  <div className="group__empty-actions">
                    <button type="button" className="text-btn group__empty-link" onClick={() => { setAddTo(g.id); setSheet({ type: 'choose' }); }}>
                      <Icon name="plus" />Add a new deck
                    </button>
                    {others > 0 && (
                      <button type="button" className="text-btn group__empty-link" onClick={() => setSheet({ type: 'group-fill', group: g })}>
                        <Icon name="folderIn" />Move decks here
                      </button>
                    )}
                  </div>
                </>
              );
            }}
            menuItemsFor={(g, inGroup) => [
              { label: 'Shuffle this group', icon: 'shuffle', disabled: !inGroup.length, onSelect: () => onShuffle(inGroup.map((d) => d.id)) },
              { label: 'Reorder decks', icon: 'sort', disabled: inGroup.length < 2, onSelect: () => startReorder(inGroup, `Reorder ${g.title}`) },
              { label: 'Repaint decks', icon: 'repaint', disabled: !inGroup.length, onSelect: () => onRainbow(inGroup.map((d) => d.id)) },
              { label: 'Move decks here', icon: 'folderIn', disabled: inGroup.length === decks.length, onSelect: () => setSheet({ type: 'group-fill', group: g }) },
              { label: 'New group', icon: 'folderAdd', onSelect: () => setSheet({ type: 'group-new', after: g.id }) },
              { label: 'Share group', icon: 'share', disabled: !inGroup.length, onSelect: () => setSheet({ type: 'group-share', group: g }) },
              { divider: true },
              { label: 'Delete group', icon: 'trash', danger: true, disabled: sortedGroups.length < 2, onSelect: () => setSheet({ type: 'group-delete', group: g, count: inGroup.length }) },
            ]}
          />
        )}
        {!grouped && !reordering && canDrag && !query && (
          <SortableDecks decks={decks} onReorder={onReorder} renderDeck={(deck) => (
              <DeckCard
                deck={deck}
                mode={colorMode}
                due={dueByDeck[deck.id] || 0}
                onOpen={() => onStudyDeck(deck)}
                onUpdateUrl={() => setSheet({ type: 'url', deck })}
                onCustomize={() => setSheet({ type: 'cover', deck })}
                onShare={() => setSheet({ type: 'share', deck })}
                onResetProgress={() => setSheet({ type: 'reset', deck })}
                onRemove={() => setSheet({ type: 'remove', deck })}
              />
            )} />
        )}
        {!grouped && !reordering && !(canDrag && !query) && <AnimatePresence initial={false} mode="popLayout">
          {visible.map((deck) => (
            <motion.div
              key={deck.id}
              layout="position"
              initial={query ? { opacity: 0, scale: 0.94 } : false}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
              transition={SPRING.morph}
            >
              {((deck) => (
              <DeckCard
                deck={deck}
                mode={colorMode}
                due={dueByDeck[deck.id] || 0}
                onOpen={() => onStudyDeck(deck)}
                onUpdateUrl={() => setSheet({ type: 'url', deck })}
                onCustomize={() => setSheet({ type: 'cover', deck })}
                onShare={() => setSheet({ type: 'share', deck })}
                onResetProgress={() => setSheet({ type: 'reset', deck })}
                onRemove={() => setSheet({ type: 'remove', deck })}
              />
            ))(deck)}
            </motion.div>
          ))}
        </AnimatePresence>}
      </section>
      </>}

      {!reordering && !wide && <TabBar tab={searching ? 'decks' : tab} onTab={(t) => { if (searching) closeSearch(); setTab(t); }} onAdd={() => setSheet({ type: 'choose' })} />}

      <Sheet open={sheet?.type === 'choose'} onClose={close} title="Create your own deck" variant="dialog">
        <div className="sheet__body">
          <p className="sheet__text">
            Import cards from Google Sheets or create a new deck with AI.
            {addToTitle && <> It goes into “{addToTitle}”.</>}
          </p>
          <SheetActions>
            <CreateChoices onAi={() => setSheet({ type: 'ai' })} onPaste={() => setSheet({ type: 'paste' })} onImport={() => setSheet({ type: 'add' })} />
            {remainingReadyMade.length > 0 && (
              <button type="button" className="text-btn" onClick={() => setSheet({ type: 'library' })}>
                Browse ready-made decks
              </button>
            )}
          </SheetActions>
        </div>
      </Sheet>

      <Sheet open={sheet?.type === 'account'} onClose={close} title="Account">
        <Account
          user={user}
          onUserUpdated={onUserUpdated}
          onSignOut={onSignOut}
        />
      </Sheet>

      <Sheet open={sheet?.type === 'theme'} onClose={close} title="Theme">
        <ThemeSettings colorMode={colorMode} onColorMode={onColorMode} />
      </Sheet>

      <Sheet open={sheet?.type === 'shuffle'} onClose={close} title="Shuffle decks" variant="dialog">
        <ShufflePicker
          decks={decks}
          onStart={(ids) => { close(); onShuffle(ids); }}
        />
      </Sheet>

      <Sheet open={sheet?.type === 'library'} onClose={close} title="Ready-made decks">
        <div className="sheet__body">
          {remainingReadyMade.length > 0 && <p className="sheet__text">Tap a deck to add it. Add as many as you like.</p>}
          {remainingReadyMade.length ? (
            <div className="start-tile__samples library">
              <AnimatePresence initial={false} mode="popLayout">
                {remainingReadyMade.map((r) => (
                  <motion.div
                    key={r.key}
                    layout
                    initial={false}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, x: 40, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
                    transition={SPRING.morph}
                  >
                    <SampleCard
                      title={r.title}
                      color={r.color}
                      shape={r.shape}
                      onClick={() => addSample(r.key)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="library-done">
              <p className="sheet__text">You’ve added every ready-made deck.</p>
              <Button onClick={close}>Done</Button>
            </div>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet?.type === 'add'} onClose={close} title="Import from Google Sheets">
        <DeckUrlForm
          submitLabel="Import deck"
          onSubmit={async (parsed, extra) => {
            await addDeck({
              title: extra.title || parsed.backLabel,
              csv_url: parsed.csvUrl,
              front_label: parsed.frontLabel,
              back_label: parsed.backLabel,
              lang: inferLang(parsed.backLabel),
              ...pickDeckLook(decks),
              cards: parsed.cards,
            });
            close();
          }}
          withTitle
        />
      </Sheet>

      <Sheet open={sheet?.type === 'ai'} onClose={close} title="Create with AI" wide>
        <AiBuilder
          onCreate={async (deck) => {
            await addDeck({ ...deck, ...pickDeckLook(decks) });
            close();
          }}
        />
      </Sheet>

      <Sheet open={sheet?.type === 'paste'} onClose={close} title="Paste AI deck prompt">
        <AiBuilder
          pasteOnly
          onCreate={async (deck) => {
            await addDeck({ ...deck, ...pickDeckLook(decks) });
            close();
          }}
        />
      </Sheet>

      <Sheet open={sheet?.type === 'url'} onClose={close} title="Update URL">
        {sheet?.deck && (
          <DeckUrlForm
            initialUrl={sheet.deck.csv_url || ''}
            submitLabel="Update deck"
            onSubmit={async (parsed) => {
              await onUpdateDeck(sheet.deck.id, {
                csv_url: parsed.csvUrl,
                front_label: parsed.frontLabel,
                back_label: parsed.backLabel,
                cards: parsed.cards,
                is_sample: false,
              });
              close();
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'cover'} onClose={close} title="Edit deck">
        {sheet?.deck && (
          <CoverForm
            deck={sheet.deck}
            onSave={(patch) => onUpdateDeck(sheet.deck.id, patch)}
            onDone={close}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'share'} onClose={close} title="Share deck" variant="dialog">
        {sheet?.deck && <ShareSheet deck={sheet.deck} onShare={onShareDeck} onStop={async () => { await onStopSharing(sheet.deck.id); close(); }} />}
      </Sheet>

      <Sheet open={sheet?.type === 'move'} onClose={close} title="Move to group" variant="dialog">
        {sheet?.deck && (
          <MoveToGroup
            deck={sheet.deck}
            groups={sortedGroups}
            onMove={async (groupId) => { await onMoveDeck(sheet.deck.id, groupId); close(); }}
            onCreate={async (title) => { const g = await onCreateGroup(title); await onMoveDeck(sheet.deck.id, g.id); close(); }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'group-fill'} onClose={close} title={sheet?.group ? `Move decks to “${sheet.group.title}”` : 'Move decks'} variant="dialog">
        {sheet?.type === 'group-fill' && (
          <MoveDecksPicker
            group={sheet.group}
            decks={decks.filter((d) => d.group_id !== sheet.group.id)}
            groups={sortedGroups}
            onMove={async (ids) => { await onMoveDecks(ids, sheet.group.id); close(); }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'group-new' || sheet?.type === 'group-rename'} onClose={close} title={sheet?.type === 'group-rename' ? 'Rename group' : 'New group'} variant="dialog">
        {(sheet?.type === 'group-new' || sheet?.type === 'group-rename') && (
          <GroupNameForm
            initial={sheet.group?.title || ''}
            submitLabel={sheet.type === 'group-rename' ? 'Save' : 'Create group'}
            hint={sheet.type === 'group-new' ? 'Then drag decks into it, or use Move decks here to bring in several at once.' : null}
            onSubmit={async (title) => {
              if (sheet.type === 'group-rename') await onUpdateGroup(sheet.group.id, { title });
              else await onCreateGroup(title, sheet.after);
              close();
            }}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'group-delete'} onClose={close} title="Delete group and its decks?" variant="dialog">
        {sheet?.group && (
          <div className="sheet__body">
            <p className="sheet__text">
              {sheet.count
                ? <>“{sheet.group.title}” and its {sheet.count} {sheet.count === 1 ? 'deck' : 'decks'} will be deleted, with their progress. This can’t be undone.</>
                : <>“{sheet.group.title}” will be deleted.</>}
            </p>
            <SheetActions>
              <Button variant="danger" onClick={async () => { await onDeleteGroup(sheet.group.id, { withDecks: true }); close(); }}>
                {sheet.count ? `Delete group and ${sheet.count} ${sheet.count === 1 ? 'deck' : 'decks'}` : 'Delete group'}
              </Button>
              {sheet.count > 0 && (() => {
                const other = sortedGroups.find((x) => x.id !== sheet.group.id);
                return other && (
                  <Button variant="secondary" onClick={async () => { await onDeleteGroup(sheet.group.id, { moveTo: other.id }); close(); }}>
                    Keep the decks: move to “{other.title}”
                  </Button>
                );
              })()}
            </SheetActions>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'group-share'} onClose={close} title="Share group" variant="dialog">
        {sheet?.group && (
          <ShareSheet
            deck={sheet.group}
            onShare={onShareGroup}
            onStop={async () => { await onStopSharingGroup(sheet.group.id); close(); }}
            text={`Anyone with this link can add copies of all the decks in “${sheet.group.title}” to their own Alle. Your progress stays private.`}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'reset'} onClose={close} title="Reset progress" variant="dialog">
        {sheet?.deck && (
          <div className="sheet__body">
            <p className="sheet__text">
              Every card in “{sheet.deck.title}” will count as new again, as if you’d never studied it. This can’t be undone.
            </p>
            <SheetActions>
              <Button variant="danger" onClick={async () => { await onResetProgress(sheet.deck.id); close(); }}>
                Reset progress
              </Button>
              <Button variant="secondary" onClick={close}>Keep progress</Button>
            </SheetActions>
          </div>
        )}
      </Sheet>

      <Sheet open={sheet?.type === 'remove'} onClose={close} title="Remove deck" variant="dialog">
        {sheet?.deck && (
          <div className="sheet__body">
            <p className="sheet__text">
              “{sheet.deck.title}” and its study progress will be removed. Your Google Sheet stays as it is.
            </p>
            <SheetActions>
              <Button
                variant="danger"
                onClick={async () => { await onRemoveDeck(sheet.deck.id); close(); }}
              >
                Remove deck
              </Button>
              <Button variant="secondary" onClick={close}>Keep deck</Button>
            </SheetActions>
          </div>
        )}
      </Sheet>
    </main>
    </>
  );
}

function DeckUrlForm({ initialUrl = '', submitLabel, onSubmit, withTitle = false }) {
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Prefill the deck name from the sheet's own name once a link is pasted.
  // Stops as soon as the person types their own name.
  const [nameEdited, setNameEdited] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  useEffect(() => {
    if (!withTitle || nameEdited || !/docs\.google\.com\/spreadsheets\//.test(url)) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLookingUp(true);
      const name = await fetchSheetName(url);
      if (cancelled) return;
      setLookingUp(false);
      if (name) { setTitle(name); setPrefilled(true); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [url, withTitle, nameEdited]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const parsed = await fetchDeckFromUrl(url);
      await onSubmit(parsed, { title: title.trim() });
    } catch (err) {
      setError(err.message || 'Something went wrong. Try the link again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sheet__body" onSubmit={submit}>
      <Field label="Published CSV link" hint="File → Share → Publish to web → Comma-separated values.">
        <input
          className="input"
          type="url"
          inputMode="url"
          name="alle-sheet-source"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="https://docs.google.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      {withTitle && (
        <Field
          label="Deck name"
          hint={lookingUp ? 'Looking up the sheet’s name…'
            : prefilled && !nameEdited ? 'Taken from your sheet. Change it if you like.'
              : 'Leave empty to use the back column’s name.'}
        >
          <input
            className="input"
            name="alle-deck-name"
            autoComplete="off"
            enterKeyHint="go"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setNameEdited(true); }}
          />
        </Field>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <SheetActions>
        <Button type="submit" disabled={busy || !url.trim()}>{busy ? 'Reading sheet…' : submitLabel}</Button>
      </SheetActions>
    </form>
  );
}

function CoverForm({ deck, onSave, onDone }) {
  const [title, setTitle] = useState(deck.title);
  const [color, setColor] = useState(deck.color);
  const [shape, setShape] = useState(deckShape(deck));
  const [lang, setLang] = useState(deck.lang);
  const [mode, setMode] = useState(answerMode(deck));
  const canChoose = answerMode({ ...deck, answer_mode: 'choice' }) === 'choice';
  const [status, setStatus] = useState(''); // '' | 'saving' | 'saved'
  const [error, setError] = useState('');
  const current = deckColorVars(color);

  // Changes save on their own: taps right away, the name once typing pauses.
  async function save(patch) {
    setStatus('saving'); setError('');
    try {
      await onSave(patch);
      setStatus('saved');
    } catch (err) {
      setStatus('');
      setError(/answer_mode/.test(rawError(err))
        ? 'Answer settings need one database update. Run supabase/003_answer_mode.sql in Supabase.'
        : /shape/.test(rawError(err))
          ? 'Shapes need one database update. Run supabase/002_shapes.sql in Supabase.'
          : 'Couldn’t save that change. Check your connection and try again.');
    }
  }
  const pick = (setter, key) => (value) => { setter(value); save({ [key]: value }); };
  useEffect(() => {
    const name = title.trim();
    if (!name || name === deck.title) return undefined;
    const t = setTimeout(() => save({ title: name }), 600);
    return () => clearTimeout(t);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status !== 'saved') return undefined;
    const t = setTimeout(() => setStatus(''), 1800);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div className="sheet__body">
      <DeckPreview
        deck={{ ...deck, title, color, shape }}
        titleSlot={(
          <AutoInput
            className="deck__title deck__title-auto"
            label="Deck name"
            name="alle-deck-name"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      />
      <p className="field__hint deck__title-hint">Tap the name to rename the deck.</p>

      <fieldset className="picker">
        <legend className="field__label">Colour</legend>
        <div className="colors">
          {[NO_COLOR, ...DECK_COLORS].map((c) => {
            const { fill, deep, ink, ink2 } = deckColorVars(c);
            const label = c === NO_COLOR ? 'No colour' : DECK_COLOR_LABELS[c];
            return (
              <label key={c} className={`color ${c === NO_COLOR ? 'color--none' : ''}`} style={{ '--deck-fill': fill, '--deck-deep': deep, '--deck-ink': ink, '--deck-ink-2': ink2 }}>
                <input type="radio" name="color" value={c} checked={color === c} onChange={() => pick(setColor, 'color')(c)} />
                <span className="color__dot" />
                <span className="visually-hidden">{label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="picker">
        <legend className="field__label">Shape</legend>
        <div className="shapes" style={{ '--deck-fill': current.fill, '--deck-deep': current.deep }}>
          {DECK_SHAPES.map((sh, i) => (
            <label key={sh} className="shape">
              <input type="radio" name="shape" value={sh} checked={shape === sh} onChange={() => pick(setShape, 'shape')(sh)} />
              <span className="shape__tile"><DeckShape shape={sh} /></span>
              <span className="visually-hidden">Shape {i + 1}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {canChoose && (
        <div className="builder__group">
          <span className="field__label" id="answer-label">Answer by</span>
          <Segmented
            labelledBy="answer-label"
            options={[{ value: 'type', label: 'Typing' }, { value: 'choice', label: 'Multiple choice' }]}
            value={mode}
            onChange={pick(setMode, 'answer_mode')}
          />
        </div>
      )}
      <Field label="Read-aloud language" hint={`Used for the speaker on the ${deck.back_label} side.`}>
        <select className="input" value={lang} onChange={(e) => pick(setLang, 'lang')(e.target.value)}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </Field>
      <VoicePicker lang={lang} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <SheetActions>
        <Button onClick={onDone}>Done</Button>
      </SheetActions>
    </div>
  );
}

function ShufflePicker({ decks, onStart }) {
  const [chosen, setChosen] = useState(() => new Set(decks.map((d) => d.id)));
  const toggle = (id) => setChosen((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const all = chosen.size === decks.length;
  return (
    <div className="sheet__body shuffle-body">
      <div className="shuffle-head">
        <p className="sheet__text">Pick decks to shuffle</p>
        <button type="button" className="text-btn shuffle-head__all" onClick={() => setChosen(all ? new Set() : new Set(decks.map((d) => d.id)))}>
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="check-list shuffle-scroll">
        {decks.map((deck) => {
          const { fill, deep } = deckColorVars(deck.color);
          const on = chosen.has(deck.id);
          return (
            <label key={deck.id} className={`check-row ${on ? 'is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(deck.id)} />
              <span className="check-row__dot" style={{ '--deck-fill': fill, '--deck-deep': deep }} />
              <span className="check-row__title">{deck.title}</span>
              <span className="check-row__box">{on && <Icon name="check" />}</span>
            </label>
          );
        })}
      </div>
      <SheetActions>
        <Button icon="shuffle" disabled={chosen.size === 0} onClick={() => onStart([...chosen])}>
          {chosen.size === decks.length ? 'Shuffle all decks'
            : `Shuffle ${chosen.size} ${chosen.size === 1 ? 'deck' : 'decks'}`}
        </Button>
      </SheetActions>
    </div>
  );
}



/** Pick several decks from other groups and move them into this one. */
function MoveDecksPicker({ group, decks, groups, onMove }) {
  const [chosen, setChosen] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const groupName = Object.fromEntries(groups.map((g) => [g.id, g.title]));
  const toggle = (id) => setChosen((cur) => {
    const next = new Set(cur);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const all = chosen.size === decks.length;
  return (
    <div className="sheet__body shuffle-body">
      <div className="shuffle-head">
        <p className="sheet__text">Pick the decks to move</p>
        <button type="button" className="text-btn shuffle-head__all" onClick={() => setChosen(all ? new Set() : new Set(decks.map((d) => d.id)))}>
          {all ? 'Clear all' : 'Select all'}
        </button>
      </div>
      <div className="check-list shuffle-scroll">
        {decks.map((deck) => {
          const { fill, deep } = deckColorVars(deck.color);
          const on = chosen.has(deck.id);
          return (
            <label key={deck.id} className={`check-row ${on ? 'is-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(deck.id)} />
              <span className="check-row__dot" style={{ '--deck-fill': fill, '--deck-deep': deep }} />
              <span className="check-row__text">
                <span className="check-row__title">{deck.title}</span>
                {groupName[deck.group_id] && <span className="check-row__meta">In {groupName[deck.group_id]}</span>}
              </span>
              <span className="check-row__box">{on && <Icon name="check" />}</span>
            </label>
          );
        })}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SheetActions>
        <Button disabled={!chosen.size || busy} onClick={async () => {
          setBusy(true); setError('');
          try { await onMove([...chosen]); } catch (e) { setError(e.message); setBusy(false); }
        }}>
          {busy ? 'Moving…' : chosen.size ? `Move ${chosen.size} ${chosen.size === 1 ? 'deck' : 'decks'} to ${group.title}` : 'Choose decks to move'}
        </Button>
      </SheetActions>
    </div>
  );
}

function GroupNameForm({ initial, submitLabel, hint, onSubmit }) {
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form className="sheet__body" onSubmit={async (e) => {
      e.preventDefault(); if (!title.trim()) return;
      setBusy(true); setError('');
      try { await onSubmit(title.trim()); } catch (err) { setError(err.message); setBusy(false); }
    }}>
      <Field label="Group name" hint={hint}>
        <input className="input" autoFocus value={title} placeholder="e.g. Dutch course" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {error && <p className="form-error" role="alert">{error}</p>}
      <SheetActions><Button type="submit" disabled={busy || !title.trim()}>{busy ? 'Saving…' : submitLabel}</Button></SheetActions>
    </form>
  );
}

function MoveToGroup({ deck, groups, onMove, onCreate }) {
  const [creating, setCreating] = useState(!groups.length);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const run = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message); } };
  return (
    <div className="sheet__body">
      <p className="sheet__text">Choose a group for “{deck.title}”.</p>
      {groups.length > 0 && (
        <div className="move-list">
          {groups.map((g) => (
            <button key={g.id} type="button" className={`move-list__item ${deck.group_id === g.id ? 'is-on' : ''}`} onClick={() => run(() => onMove(g.id))}>
              <Icon name="folder" /><span>{g.title}</span>{deck.group_id === g.id && <Icon name="check" />}
            </button>
          ))}
        </div>
      )}
      {creating ? (
        <form className="move-new" onSubmit={(e) => { e.preventDefault(); if (title.trim()) run(() => onCreate(title.trim())); }}>
          <Field label="New group">
            <input className="input" autoFocus value={title} placeholder="e.g. Dutch course" onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!title.trim()}>Create and move</Button>
        </form>
      ) : (
        <button type="button" className="text-btn group__empty-link" onClick={() => setCreating(true)}><Icon name="folderAdd" />New group</button>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}

/** Share a deck by link: anyone with it can add a copy. */
function ShareSheet({ deck, onShare, onStop, text }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    onShare(deck).then((r) => alive && setLink(r.url)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [deck.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError('Couldn’t copy. Select the link and copy it yourself.'); }
  }
  async function shareNative() {
    try { await navigator.share({ title: deck.title, text: `Study “${deck.title}” with me on Alle`, url: link }); } catch { /* cancelled */ }
  }
  return (
    <div className="sheet__body">
      <p className="sheet__text">{text || `Anyone with this link can add a copy of “${deck.title}” to their own Alle. Your progress stays private.`}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <input className="input share-link" readOnly value={link || 'Creating link…'} onFocus={(e) => e.target.select()} aria-label="Share link" />
      <SheetActions>
        {typeof navigator !== 'undefined' && navigator.share
          ? <Button icon="share" disabled={!link} onClick={shareNative}>Share</Button>
          : null}
        <Button variant={typeof navigator !== 'undefined' && navigator.share ? 'secondary' : 'primary'} disabled={!link} onClick={copy}>
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
        {link && (
          <>
            <button type="button" className="text-btn" onClick={onStop}>Stop sharing</button>
            <p className="share-hint">Turns this link off. Anyone who already added the deck keeps their copy.</p>
          </>
        )}
      </SheetActions>
    </div>
  );
}

function CreateChoices({ onAi, onPaste, onImport }) {
  return (
    <div className="create-choices">
      <Button onClick={onAi}>Create with AI</Button>
      <Button variant="secondary" className="btn--on-tile" onClick={onPaste}>Paste AI deck prompt</Button>
      <Button variant="secondary" className="btn--on-tile" onClick={onImport}>Import from Google Sheets</Button>
    </div>
  );
}

/** A small deck card that adds a sample deck when tapped. */
function SampleCard({ title, color, shape, onClick, added = false }) {
  const { fill, deep, ink, ink2 } = deckColorVars(color);
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`sample-card ${added ? 'is-added' : ''} ${busy ? 'is-busy' : ''}`}
      style={{ '--deck-fill': fill, '--deck-deep': deep, '--deck-ink': ink, '--deck-ink-2': ink2 }}
      disabled={busy || added}
      aria-busy={busy}
      aria-label={added ? `${title}, already added` : `Add the sample deck ${title}`}
      onClick={async () => { setBusy(true); try { await onClick(); } finally { setBusy(false); } }}
    >
      <span className="sample-card__title">
        {title}
        {added && <span className="sample-card__added"><Icon name="check" /> Added</span>}
        {busy && <span className="sample-card__added"><span className="mini-spinner" aria-hidden="true" /> Adding…</span>}
      </span>
      <DeckShape shape={shape || color} />
    </button>
  );
}
