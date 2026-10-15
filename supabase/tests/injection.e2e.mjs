// SQL injection regression test, end to end: the same client library the app uses
// (@supabase/postgrest-js) → PostgREST (what Supabase runs) → a TEST Postgres with all
// of supabase/*.sql applied. Never point this at the real project.
//
//   PGRST_URL=http://localhost:3901 PGRST_JWT_SECRET=... node supabase/tests/injection.e2e.mjs
//   add --control to also call a deliberately unsafe test-only function (built by
//   string concatenation): the same checks must FAIL there, proving they catch injection.
//
// Test data expected (see supabase/tests/README.md): Alice owns "Alice secret deck"
// and "O'Brien's Irish"; the test signs in as Mallory, who must never see them.
import { PostgrestClient } from '@supabase/postgrest-js';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const URL = process.env.PGRST_URL || 'http://localhost:3901';
const SECRET = process.env.PGRST_JWT_SECRET;
const ALICE = '11111111-1111-1111-1111-111111111111';
const MALLORY = '22222222-2222-2222-2222-222222222222';
if (!SECRET) throw new Error('Set PGRST_JWT_SECRET (the test server secret)');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(sub) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ sub, role: 'authenticated', email: 'mallory@test', exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const db = new PostgrestClient(URL, { headers: { Authorization: `Bearer ${jwt(MALLORY)}` } });

const PAYLOADS = [
  "O'Brien's Irish",
  "x' or '1'='1",
  "x'; delete from decks; --",
  "' or user_id is not null --",
  "x,user_id.neq.00000000-0000-0000-0000-000000000000",
  "x)or(user_id.eq." + ALICE,
  '"; drop table decks; --',
];

let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log(`ok    ${label}`); }
  catch (e) { failures++; console.log(`FAIL  ${label}\n      ${e.message}`); }
}
const noAliceRows = (rows) => assert.ok((rows || []).every((r) => r.user_id !== ALICE), 'Alice\'s rows leaked');

// 1. Names with apostrophes are saved and read back exactly, as data
const tricky = "Mallory's \"deck\" '); delete from decks where ('1'='1 --";
await check('apostrophes and SQL in a deck name are stored as plain text', async () => {
  const { data, error } = await db.from('decks').insert({ title: tricky, front_label: "it's", back_label: "l'eau" }).select('id,title,user_id').single();
  assert.equal(error, null, error?.message);
  assert.equal(data.title, tricky);
  assert.equal(data.user_id, MALLORY);
  const back = await db.from('decks').select('title').eq('title', tricky);
  assert.equal(back.data.length, 1);
});

// 2. Injection in filter values never widens the owner filter
for (const p of PAYLOADS) {
  await check(`eq filter with ${JSON.stringify(p)}`, async () => {
    const { data } = await db.from('decks').select('id,user_id,title').eq('title', p);
    noAliceRows(data);
    assert.equal((data || []).length, 0);
  });
  await check(`ilike filter with ${JSON.stringify(p)}`, async () => {
    const { data } = await db.from('decks').select('id,user_id').ilike('title', `%${p}%`);
    noAliceRows(data);
  });
  await check(`update/delete targeted with ${JSON.stringify(p)} change nothing of Alice's`, async () => {
    await db.from('decks').update({ title: 'pwned' }).eq('title', p);
    await db.from('decks').delete().eq('title', p);
    await db.from('decks').update({ title: 'pwned' }).eq('id', p); // not a valid id: refused
  });
  await check(`shared-deck lookup with ${JSON.stringify(p)} returns nothing`, async () => {
    const { data } = await db.rpc('get_shared_deck', { sid: p });
    assert.ok(!data || data.length === 0);
  });
}

// 3. Mallory still only sees Mallory's decks
await check('after all attempts, only own decks are visible', async () => {
  const { data, error } = await db.from('decks').select('user_id,title');
  assert.equal(error, null, error?.message);
  noAliceRows(data);
  assert.ok(data.length >= 1);
});

// Control: a deliberately unsafe function (test database only). These checks MUST fail.
if (process.argv.includes('--control')) {
  console.log('\n-- control: unsafe_find_decks (string concatenation), expected to FAIL --');
  for (const p of PAYLOADS.slice(1, 4)) {
    await check(`unsafe function with ${JSON.stringify(p)}`, async () => {
      const { data } = await db.rpc('unsafe_find_decks', { name: p });
      noAliceRows(data);
    });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exitCode = failures ? 1 : 0;
