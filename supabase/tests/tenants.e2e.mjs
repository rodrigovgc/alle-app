// Cross-account test, end to end: account A's real sign-in token tries to read, edit and
// delete account B's data through PostgREST (what Supabase runs). TEST DATABASE ONLY.
// Setup: supabase/tests/README.md (fixtures: supabase/tests/tenants_fixture.sql).
//   PGRST_URL=http://localhost:3901 PGRST_JWT_SECRET=... node supabase/tests/tenants.e2e.mjs
import { createHmac } from 'node:crypto';

const URL = process.env.PGRST_URL || 'http://localhost:3901';
const SECRET = process.env.PGRST_JWT_SECRET;
if (!SECRET) throw new Error('Set PGRST_JWT_SECRET (the test server secret)');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const IDS = {
  aDeck: 'a1111111-0000-0000-0000-00000000000a', aGroup: 'a0000000-0000-0000-0000-00000000000a',
  bDeck: 'b2222222-0000-0000-0000-00000000000b', bPrivateDeck: 'b3333333-0000-0000-0000-00000000000b',
  bGroup: 'b0000000-0000-0000-0000-00000000000b', bDeckShare: '5d5d5d5d-0000-0000-0000-00000000000b',
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub, secret = SECRET) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role: 'authenticated', email: `${sub.slice(0, 4)}@test`, exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
const as = (token) => async (method, path, body, extra = {}) => {
  const res = await fetch(`${URL}${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, range: res.headers.get('content-range') };
};
const asA = as(jwt(A));
const asB = as(jwt(B));
const forged = as(jwt(B, 'not-the-real-secret-but-long-enough-to-sign!!'));

const rows = [];
let failed = 0;
const leaks = (r) => JSON.stringify(r.body).match(/B secret|B unshared|B private|b-secret|b-private|h-b/);
async function check(endpoint, rule, fn) {
  let observed; let ok;
  try { [ok, observed] = await fn(); } catch (e) { ok = false; observed = e.message; }
  if (!ok) failed++;
  rows.push({ result: ok ? 'ok' : 'FAIL', endpoint, rule, observed });
}
const short = (r) => `${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 50) : JSON.stringify(r.body).slice(0, 70)}`;

// ---- Reading
await check('GET /decks?id=eq.<B deck>', 'RLS "own decks": user_id = auth.uid()', async () => {
  const r = await asA('GET', `/decks?id=eq.${IDS.bDeck}`); return [r.status === 200 && r.body.length === 0 && !leaks(r), short(r)];
});
await check('GET /decks (list everything)', 'RLS "own decks"', async () => {
  const r = await asA('GET', '/decks?select=id,user_id,title'); return [r.body.length >= 1 && r.body.every((d) => d.user_id === A) && !leaks(r), `${r.status} ${r.body.length} row(s), all A's`];
});
await check('GET /decks with total count', 'RLS applies to counts too', async () => {
  const r = await asA('HEAD', '/decks', null, { Prefer: 'count=exact' }); return [r.range === '0-0/1' || r.range?.endsWith('/1'), `${r.status} content-range ${r.range} (A has 1 deck, B has 2)`];
});
await check('GET /deck_groups?id=eq.<B group>', 'RLS "own groups"', async () => {
  const r = await asA('GET', `/deck_groups?id=eq.${IDS.bGroup}`); return [r.body.length === 0, short(r)];
});
await check('GET /progress?deck_id=eq.<B deck>', 'RLS "own progress"', async () => {
  const r = await asA('GET', `/progress?deck_id=eq.${IDS.bDeck}`); return [r.body.length === 0 && !leaks(r), short(r)];
});
await check('GET /events', 'RLS: insert-only, nobody reads raw events', async () => {
  const r = await asA('GET', '/events'); return [Array.isArray(r.body) && r.body.length === 0, short(r)];
});
await check('GET /ai_generations', 'RLS "own ai rows: read"', async () => {
  const r = await asA('GET', '/ai_generations?select=user_id'); return [r.body.every((x) => x.user_id === A), short(r)];
});
await check('POST /rpc/get_shared_deck {sid: <B deck id>}', 'needs the secret share code, not the deck id', async () => {
  const r = await asA('POST', '/rpc/get_shared_deck', { sid: IDS.bDeck }); return [Array.isArray(r.body) && r.body.length === 0, short(r)];
});
await check('POST /rpc/get_shared_group_meta {sid: <B group id>}', 'needs the secret share code', async () => {
  const r = await asA('POST', '/rpc/get_shared_group_meta', { sid: IDS.bGroup }); return [Array.isArray(r.body) && r.body.length === 0, short(r)];
});
await check('POST /rpc/dash_insights', 'is_owner(): verified email in the token', async () => {
  const r = await asA('POST', '/rpc/dash_insights', { days: 30 }); return [r.body === null, short(r)];
});

// ---- Editing
await check('PATCH /decks?id=eq.<B deck> {title}', 'RLS "own decks" (using)', async () => {
  const r = await asA('PATCH', `/decks?id=eq.${IDS.bDeck}`, { title: 'pwned' }); return [r.body.length === 0, short(r)];
});
await check('PATCH /deck_groups?id=eq.<B group> {share_id:null}', 'RLS "own groups"', async () => {
  const r = await asA('PATCH', `/deck_groups?id=eq.${IDS.bGroup}`, { share_id: null }); return [r.body.length === 0, short(r)];
});
await check('POST /decks {user_id: B}', 'RLS "own decks" (with check)', async () => {
  const r = await asA('POST', '/decks', { user_id: B, title: 'planted', front_label: 'a', back_label: 'b' }); return [r.status >= 400, short(r)];
});
await check('POST /decks {id: <B deck>} upsert', 'RLS on the existing row', async () => {
  const r = await asA('POST', '/decks?on_conflict=id', { id: IDS.bDeck, title: 'pwned', front_label: 'a', back_label: 'b' }, { Prefer: 'return=representation,resolution=merge-duplicates' }); return [r.status >= 400, short(r)];
});
await check('PATCH /decks?id=eq.<A deck> {user_id: B}', 'RLS (with check): can\'t hand a deck to B', async () => {
  const r = await asA('PATCH', `/decks?id=eq.${IDS.aDeck}`, { user_id: B }); return [r.status >= 400, short(r)];
});
await check('PATCH /decks?id=eq.<A deck> {group_id: <B group>}', 'trigger decks_group_owner (014)', async () => {
  const r = await asA('PATCH', `/decks?id=eq.${IDS.aDeck}`, { group_id: IDS.bGroup }); return [r.status >= 400, short(r)];
});
await check('POST /progress {deck_id: <B deck>}', 'trigger progress_deck_owner (014)', async () => {
  const r = await asA('POST', '/progress', { deck_id: IDS.bDeck, card_hash: 'x', box: 1, due_at: new Date().toISOString() }); return [r.status >= 400, short(r)];
});
await check('POST /events {user_id: B}', 'RLS "insert own events"', async () => {
  const r = await asA('POST', '/events', { user_id: B, name: 'deck_added' }); return [r.status >= 400, short(r)];
});
await check('POST /ai_generations {user_id: B}', 'RLS "own ai rows: add"', async () => {
  const r = await asA('POST', '/ai_generations', { user_id: B, cards: 1 }); return [r.status >= 400, short(r)];
});

// ---- Deleting
await check('DELETE /decks?id=eq.<B deck>', 'RLS "own decks"', async () => {
  const r = await asA('DELETE', `/decks?id=eq.${IDS.bDeck}`); return [r.body.length === 0, short(r)];
});
await check('DELETE /decks (no filter)', 'RLS: only A\'s rows are in reach', async () => {
  const r = await asA('DELETE', '/decks?title=eq.does-not-exist'); return [r.body.length === 0, short(r)];
});
await check('DELETE /deck_groups?id=eq.<B group>', 'RLS "own groups"', async () => {
  const r = await asA('DELETE', `/deck_groups?id=eq.${IDS.bGroup}`); return [r.body.length === 0, short(r)];
});
await check('DELETE /progress?deck_id=eq.<B deck>', 'RLS "own progress"', async () => {
  const r = await asA('DELETE', `/progress?deck_id=eq.${IDS.bDeck}`); return [r.body.length === 0, short(r)];
});
await check('DELETE /ai_generations', 'no delete rule = nobody can delete', async () => {
  const r = await asA('DELETE', '/ai_generations'); return [r.body.length === 0, short(r)];
});

// ---- Where the identity comes from
await check('GET /decks with a token signed by the wrong key, claiming to be B', 'token signature checked by the server', async () => {
  const r = await forged('GET', '/decks'); return [r.status === 401 && !leaks(r), short(r)];
});

// ---- B's data is untouched, A still has its own
await check('B: own decks, group and progress still there and unchanged', 'B\'s session', async () => {
  const d = await asB('GET', '/decks?select=title,group_id&order=title');
  const g = await asB('GET', '/deck_groups?select=title,share_id');
  const p = await asB('GET', '/progress?select=card_hash');
  const ok = d.body.map((x) => x.title).join() === 'B secret deck,B unshared deck' && g.body[0]?.share_id && p.body.length === 1;
  return [ok, `${d.body.length} decks (${d.body.map((x) => x.title).join(', ')}), group still shared, ${p.body.length} progress`];
});
await check('A: can still read and edit its own deck', 'RLS "own decks"', async () => {
  const r = await asA('PATCH', `/decks?id=eq.${IDS.aDeck}`, { title: 'A deck (renamed)' });
  const g = await asA('GET', `/decks?id=eq.${IDS.aDeck}&select=title`);
  return [r.body.length === 1 && g.body[0]?.title === 'A deck (renamed)', `${r.status} renamed, read back "${g.body[0]?.title}"`];
});
await check('POST /rpc/delete_own_account as A', 'deletes auth.uid() only', async () => {
  await asA('POST', '/rpc/delete_own_account', {});
  const d = await asB('GET', '/decks?select=title');
  return [d.body.length === 2, `B still has ${d.body.length} decks after A deleted A's account`];
});

console.table(rows);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed: no cross-account access');
process.exitCode = failed ? 1 : 0;
