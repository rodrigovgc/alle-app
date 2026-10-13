import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin,
  useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Icon } from './Icon.jsx';
import { Menu } from './Menu.jsx';

/*
 * Home with groups: each group is a collapsible section (drag its title to
 * reorder groups, click its name to rename), followed by decks without a
 * group. With a mouse, decks can be dragged into another group, or out of one.
 * On touch, a long press on a group's title reorders groups; decks move with
 * "Move to group" in their menu.
 */

const G = (id) => `g:${id}`;
const D = (id) => `d:${id}`;
const C = (key) => `c:${key}`;
const NONE = 'none';
const idOf = (key) => String(key).slice(2);
const isGroupKey = (k) => String(k).startsWith('g:');
const isDeckKey = (k) => String(k).startsWith('d:');

function build(groups, decks) {
  const ids = new Set(groups.map((g) => g.id));
  const items = { [NONE]: [] };
  groups.forEach((g) => { items[g.id] = []; });
  decks.forEach((d) => { items[d.group_id && ids.has(d.group_id) ? d.group_id : NONE].push(d.id); });
  return items;
}

export function GroupedBoard({
  groups, decks, renderDeck, canDragDecks, menuItemsFor,
  onToggle, onRename, onReorderGroups, onDecksChange, emptyFor,
}) {
  const [items, setItems] = useState(() => build(groups, decks));
  const [active, setActive] = useState(null);
  const byId = useMemo(() => Object.fromEntries(decks.map((d) => [d.id, d])), [decks]);
  useEffect(() => { if (!active) setItems(build(groups, decks)); }, [groups, decks, active]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (deckId, from = items) => Object.keys(from).find((k) => from[k].includes(deckId));
  const targetOf = (overId) => {
    if (!overId) return null;
    if (isDeckKey(overId)) return containerOf(idOf(overId));
    if (isGroupKey(overId)) return idOf(overId);
    return idOf(overId); // c:<group id> or c:none
  };

  // Groups only collide with groups; decks prefer the deck or area under the pointer.
  const collision = (args) => {
    if (isGroupKey(args.active.id)) {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => isGroupKey(c.id)) });
    }
    const hits = pointerWithin(args);
    if (hits.length) return [hits.find((h) => isDeckKey(h.id)) || hits[0]];
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => !isGroupKey(c.id) || true) });
  };

  function onDragOver({ active: a, over }) {
    if (!over || !isDeckKey(a.id)) return;
    const deckId = idOf(a.id);
    const from = containerOf(deckId);
    const to = targetOf(over.id);
    if (!from || !to || from === to || !(to in items)) return;
    setItems((cur) => {
      const next = { ...cur, [from]: cur[from].filter((x) => x !== deckId) };
      const list = [...cur[to]];
      const at = isDeckKey(over.id) ? Math.max(0, list.indexOf(idOf(over.id))) : list.length;
      list.splice(at, 0, deckId);
      next[to] = list;
      return next;
    });
  }

  function onDragEnd({ active: a, over }) {
    setActive(null);
    if (!over) { setItems(build(groups, decks)); return; }
    if (isGroupKey(a.id)) {
      const from = groups.findIndex((g) => g.id === idOf(a.id));
      const toKey = targetOf(over.id);
      const to = groups.findIndex((g) => g.id === toKey);
      if (from >= 0 && to >= 0 && from !== to) onReorderGroups(arrayMove(groups, from, to));
      return;
    }
    // A deck: settle its place, then report the whole new order with groups
    const deckId = idOf(a.id);
    const key = containerOf(deckId);
    let next = items;
    if (isDeckKey(over.id) && containerOf(idOf(over.id)) === key) {
      const list = items[key];
      next = { ...items, [key]: arrayMove(list, list.indexOf(deckId), list.indexOf(idOf(over.id))) };
    }
    const ordered = [
      ...groups.flatMap((g) => (next[g.id] || []).map((id) => ({ ...byId[id], group_id: g.id }))),
      ...next[NONE].map((id) => ({ ...byId[id], group_id: null })),
    ];
    const changed = ordered.some((d, i) => d.id !== decks[i]?.id || (d.group_id || null) !== (byId[d.id].group_id || null));
    if (changed) onDecksChange(ordered);
    setItems(next);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={({ active: a }) => setActive(a.id)}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setActive(null); setItems(build(groups, decks)); }}
    >
      {/* "Your decks": new decks wait here, above the groups, until they're moved into one */}
      {items[NONE].length > 0 && (
        <section className="group group--none group--recent" aria-label="Your decks">
          <div className="home__title-row group__head">
            <h2 className="home__title group__title">Your decks</h2>
          </div>
          <p className="group__hint">Organise what you’re learning into groups.</p>
          <DeckArea containerKey={NONE} ids={items[NONE]} byId={byId} renderDeck={renderDeck} canDrag={canDragDecks}
            empty="Drop a deck here to take it out of its group." />
        </section>
      )}
      <SortableContext items={groups.map((g) => G(g.id))} strategy={verticalListSortingStrategy}>
        {groups.map((g) => (
          <GroupSection
            key={g.id}
            group={g}
            items={menuItemsFor(g, (items[g.id] || []).map((id) => byId[id]).filter(Boolean))}
            onToggle={() => onToggle(g)}
            onRename={(title) => onRename(g, title)}
          >
            <DeckArea containerKey={g.id} ids={items[g.id] || []} byId={byId} renderDeck={renderDeck} canDrag={canDragDecks}
              empty={emptyFor ? emptyFor(g) : 'No decks yet.'} />
          </GroupSection>
        ))}
      </SortableContext>
    </DndContext>
  );
}

function DeckArea({ containerKey, ids, byId, renderDeck, canDrag, empty }) {
  const { setNodeRef, isOver } = useDroppable({ id: C(containerKey) });
  return (
    <SortableContext items={ids.map(D)} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className={`deck-list group__decks ${isOver ? 'is-over' : ''}`}>
        {ids.length
          ? ids.map((id) => byId[id] && <SortableDeck key={id} id={id} disabled={!canDrag}>{renderDeck(byId[id])}</SortableDeck>)
          : <div className={`group__empty ${isOver ? 'is-over' : ''}`}>{empty}</div>}
      </div>
    </SortableContext>
  );
}

function SortableDeck({ id, disabled, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: D(id), disabled });
  return (
    <div
      ref={setNodeRef}
      className={`sortable-deck ${isDragging ? 'is-dragging' : ''} ${disabled ? 'is-static' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(disabled ? {} : attributes)}
      {...(disabled ? {} : listeners)}
    >
      {children}
    </div>
  );
}

function GroupSection({ group, items, onToggle, onRename, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [animating, setAnimating] = useState(false);
  const reduce = useReducedMotion();
  const open = !group.collapsed;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: G(group.id), disabled: editing });
  return (
    <section
      ref={setNodeRef}
      id={`group-${group.id}`}
      className={`group ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-label={group.title}
    >
      <div className="home__title-row group__head" {...attributes} {...listeners} title="Drag to reorder groups">
        <GroupName title={group.title} editing={editing} setEditing={setEditing} onRename={onRename} />
        <button type="button" className="group__chevron-btn" aria-expanded={open} aria-label={open ? `Collapse ${group.title}` : `Expand ${group.title}`} onClick={onToggle}>
          <Icon name="chevron" className={`group__chevron ${open ? '' : 'is-closed'}`} />
        </button>
        <span className="group__spacer" />
        <div className="group__menu">
          <button type="button" className="group__more" aria-label={`Options for group ${group.title}`} onClick={() => setMenuOpen(true)}>
            <Icon name="settings" />
          </button>
          <Menu open={menuOpen} onClose={() => setMenuOpen(false)} items={items} className="menu--deck" />
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            // Clip only while opening or closing, so deck menus can reach past the group
            style={{ overflow: animating ? 'hidden' : 'visible' }}
            onAnimationStart={() => setAnimating(true)}
            onAnimationComplete={() => setAnimating(false)}
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Click the name to rename the group; Enter or leaving the field saves. */
function GroupName({ title, editing, setEditing, onRename }) {
  const [value, setValue] = useState(title);
  const ref = useRef(null);
  useEffect(() => { if (!editing) setValue(title); }, [title, editing]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  const save = () => {
    setEditing(false);
    const v = value.trim();
    if (v && v !== title) onRename(v); else setValue(title);
  };
  return (
    <h2 className="home__title group__title">
      {editing ? (
        <span className="gname-edit">
          <span className="gname gname--sizer" aria-hidden="true">{value || ' '}</span>
          <input
            ref={ref}
            className="gname gname--input"
            size={1}
            value={value}
            aria-label="Group name"
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setValue(title); setEditing(false); }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          />
        </span>
      ) : (
        <button type="button" className="gname gname--button" onClick={() => setEditing(true)} aria-label={`Rename group ${title}`}>{title}</button>
      )}
    </h2>
  );
}
