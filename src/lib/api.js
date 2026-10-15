import { SAMPLE_DECKS } from './sampleDeck.js';
import { supabase } from './supabase.js';
import { plainDbError } from './dbErrors.js';

const DECK_FIELDS = '*'; // tolerant of optional columns added by later migrations

function check({ data, error }) {
  if (error) throw plainDbError(error);
  return data;
}

/* ---- Decks ------------------------------------------------------------- */

/** Decks in the user's order: by position, then oldest first. Decks without a
 *  position (new ones, or before the 004 migration) go at the end. Sorted here,
 *  not in the query, so a missing column can't break loading. */
export async function listDecks() {
  const rows = check(await supabase.from('decks').select(DECK_FIELDS).order('created_at', { ascending: true }));
  return sortDecks(rows.map(refreshReadyMade));
}

/** A ready-made deck added earlier picks up the latest cards and settings. */
function refreshReadyMade(deck) {
  if (!deck.is_sample) return deck;
  const latest = Object.values(SAMPLE_DECKS).find((d) => d.title === deck.title);
  if (!latest) return deck;
  return {
    ...deck,
    cards: latest.cards,
    answer_mode: deck.answer_mode ?? latest.answer_mode ?? null,
  };
}

export function sortDecks(rows) {
  const pos = (d) => (typeof d.position === 'number' ? d.position : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => pos(a) - pos(b) || String(a.created_at).localeCompare(String(b.created_at)));
}

/** Save a new order: only decks whose position changed are written. */
export async function saveOrder(orderedDecks) {
  const changed = orderedDecks
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.position !== i);
  await Promise.all(changed.map(({ d, i }) => updateDeck(d.id, { position: i })));
  return orderedDecks.map((d, i) => ({ ...d, position: i }));
}

/** "Failed to fetch" and friends: the request never reached the server. */
export const isNetworkError = (e) => /failed to fetch|networkerror|load failed|network request failed/i.test(e?.raw || e?.message || '');

/** A message people can act on, instead of the browser's raw wording. */
/** The database's own wording, for checks like "is update 004 missing?". Never shown to people. */
export const rawError = (e) => String(e?.raw || e?.message || '');

export function friendlyError(e) {
  return isNetworkError(e)
    ? 'Couldn’t reach Alle. Check your connection and try again.'
    : (e?.message || 'Something went wrong. Please try again.');
}

/** Try once more after a short pause if the network blipped. */
async function retryOnce(fn) {
  try { return await fn(); } catch (e) {
    if (!isNetworkError(e)) throw e;
    await new Promise((r) => setTimeout(r, 900));
    return fn();
  }
}

/** The database refused because the request wasn't signed in (sign-in lapsed). */
export const isAuthLapse = (e) => /row-level security|jwt expired|invalid jwt|not authenticated|auth session missing/i.test(e?.raw || e?.message || '');

export class SignedOutError extends Error {}

/**
 * Save a new deck. If the sign-in quietly lapsed (common after the app sat in
 * the background), renew it and try again before giving up.
 */
/** Keep names within the database's limits (supabase/014_input_rules.sql), so a very long sheet name can't block saving. */
const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : v);
export function fitDeck(d) {
  const out = { ...d };
  if ('title' in out) out.title = cut(out.title, 300);
  if ('front_label' in out) out.front_label = cut(out.front_label, 100);
  if ('back_label' in out) out.back_label = cut(out.back_label, 100);
  return out;
}

export async function createDeck(input) {
  const deck = fitDeck(input);
  const insert = async () => {
    const res = await supabase.from('decks').insert(deck).select(DECK_FIELDS).single();
    // Before supabase/009_insights.sql runs there's no "source" column: save without it.
    if (res.error && /source/.test(res.error.message) && 'source' in deck) {
      const { source, ...rest } = deck; // eslint-disable-line no-unused-vars
      return check(await supabase.from('decks').insert(rest).select(DECK_FIELDS).single());
    }
    return check(res);
  };
  try {
    return await retryOnce(insert);
  } catch (e) {
    if (!isAuthLapse(e)) throw e;
    const { data } = await supabase.auth.refreshSession();
    if (!data?.session) throw new SignedOutError('Your sign-in expired.');
    return retryOnce(insert);
  }
}

export async function updateDeck(id, patch) {
  return check(await supabase.from('decks').update(fitDeck(patch)).eq('id', id).select(DECK_FIELDS).single());
}

export async function removeDeck(id) {
  check(await supabase.from('decks').delete().eq('id', id));
}

/* ---- Progress ---------------------------------------------------------- */

export async function listProgress(deckIds) {
  if (!deckIds.length) return [];
  return check(
    await supabase
      .from('progress')
      .select('deck_id,card_hash,box,due_at,last_reviewed_at,reviews,lapses')
      .in('deck_id', deckIds),
  );
}

/** Forget every card's box and due date in one deck: all cards count as new again. */
export async function resetProgress(deckId) {
  check(await supabase.from('progress').delete().eq('deck_id', deckId));
}

export async function saveProgress(row) {
  check(await supabase.from('progress').upsert(row, { onConflict: 'user_id,deck_id,card_hash' }));
}

/* ---- Preferences ------------------------------------------------------ */

export async function changeEmail(email) {
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw error;
}

export async function changePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

/**
 * Delete the account completely: the login, decks, progress and events.
 * Uses the delete_own_account() function from supabase/006_delete_account.sql.
 */
export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_own_account');
  if (error) {
    if (/delete_own_account|function/i.test(error.message)) {
      throw new Error('Deleting accounts needs one database update. Run supabase/006_delete_account.sql in Supabase.');
    }
    throw error;
  }
  await supabase.auth.signOut();
}

export async function updatePrefs(patch) {
  const { data, error } = await supabase.auth.updateUser({ data: patch });
  if (error) throw error;
  return data.user;
}

/** Turn on sharing for a deck and return its link (same code every time). */
export async function shareDeck(deck) {
  let id = deck.share_id;
  if (!id) {
    id = crypto.randomUUID();
    const res = await supabase.from('decks').update({ share_id: id }).eq('id', deck.id).select('share_id').single();
    if (res.error) {
      if (/share_id/.test(res.error.message)) {
        throw new Error('Sharing needs one database update. Run supabase/007_security_and_sharing.sql in Supabase.');
      }
      throw res.error;
    }
  }
  return { id, url: `${window.location.origin}/s/${id}` };  // /s/… shows the deck's cover in link previews
}

export async function stopSharing(deckId) {
  check(await supabase.from('decks').update({ share_id: null }).eq('id', deckId).select('id').single());
}

/* ---- Deck groups (supabase/010_groups.sql) ------------------------------ */
const missingGroups = (e) => /deck_groups|group_id/.test(e?.message || '');

/** Groups in their order, or null before supabase/010_groups.sql has run. */
export async function listGroups() {
  const { data, error } = await supabase.from('deck_groups').select('*').order('position', { ascending: true });
  if (error) { if (missingGroups(error)) return null; throw error; }
  return data || [];
}
export async function createGroup(group) {
  const { data, error } = await supabase.from('deck_groups').insert({ ...group, title: String(group.title ?? '').slice(0, 200) }).select('*').single();
  if (error) {
    if (missingGroups(error)) throw new Error('Groups need one database update. Run supabase/010_groups.sql in Supabase.');
    throw error;
  }
  return data;
}
export async function updateGroup(id, patch) {
  check(await supabase.from('deck_groups').update('title' in patch ? { ...patch, title: String(patch.title ?? '').slice(0, 200) } : patch).eq('id', id).select('id').single());
}
export async function removeGroup(id) {
  check(await supabase.from('deck_groups').delete().eq('id', id));
}

/** Share a whole group: one link, anyone signed in can add copies of its decks. */
export async function shareGroup(group) {
  let id = group.share_id;
  if (!id) {
    id = crypto.randomUUID();
    const res = await supabase.from('deck_groups').update({ share_id: id }).eq('id', group.id).select('share_id').single();
    if (res.error) {
      if (/share_id/.test(res.error.message)) throw new Error('Sharing groups needs one database update. Run supabase/011_share_groups.sql in Supabase.');
      throw res.error;
    }
  }
  return { id, url: `${window.location.origin}/g/${id}` };
}
export async function stopSharingGroup(groupId) {
  check(await supabase.from('deck_groups').update({ share_id: null }).eq('id', groupId).select('id').single());
}
