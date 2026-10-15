// Rate-limit tests for the server routes (the counter itself is tested in
// supabase/tests/rate_limits.test.sql). The fake database says "over the limit".
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL = 'https://db.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
process.env.VERCEL_ENV = 'production';
const { default: ai } = await import('../../api/generate-deck.js');
const { default: sheet } = await import('../../api/sheet-name.js');

function run(handler, req, fetchImpl) {
  return new Promise((resolve) => {
    const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    handler(req, res, fetchImpl);
  });
}
function fakeDb({ over }) {
  const tried = [];
  const f = async (url) => {
    tried.push(String(url));
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'u1@test' }));
    if (url.endsWith('/rpc/hit_limit')) return new Response(JSON.stringify(over ? { ok: false, retry_after: 42 } : { ok: true, left: 1 }));
    if (url.includes('/ai_generations')) return new Response(null, { status: 200, headers: { 'content-range': '0-0/0' } });
    if (url.includes('anthropic')) return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'save_flashcards', input: { cards: [{ front: 'a', back: 'b' }] } }] }));
    if (url.includes('docs.google.com')) return new Response('', { headers: { 'content-disposition': 'attachment; filename="My sheet.csv"' } });
    throw new Error(`unexpected ${url}`);
  };
  return { tried, f };
}

test('AI route: over the short-term limit → 429 with Retry-After, and the paid AI is never called', async () => {
  const db = fakeDb({ over: true });
  const real = globalThis.fetch; globalThis.fetch = db.f;
  try {
    const out = await run(ai, { method: 'POST', headers: { authorization: 'Bearer t' }, body: { spec: { topic: 'x' } } });
    assert.equal(out.code, 429);
    assert.equal(out.body.error, 'rate');
    assert.equal(out.headers['Retry-After'], '42');
    assert.ok(!db.tried.some((u) => u.includes('anthropic')));
  } finally { globalThis.fetch = real; }
});

test('AI route: under the limit → works', async () => {
  const db = fakeDb({ over: false });
  const real = globalThis.fetch; globalThis.fetch = db.f;
  try {
    const out = await run(ai, { method: 'POST', headers: { authorization: 'Bearer t' }, body: { spec: { topic: 'x', count: 10 } } });
    assert.equal(out.code, 200);
    assert.equal(out.body.cards.length, 1);
  } finally { globalThis.fetch = real; }
});

const URL_ = 'https://docs.google.com/spreadsheets/d/e/x/pub?output=csv';
test('sheet-name: signed out → 401 and Google is never contacted', async () => {
  const db = fakeDb({ over: false });
  const out = await run(sheet, { query: { url: URL_ }, headers: {} }, db.f);
  assert.equal(out.code, 401);
  assert.equal(db.tried.length, 0);
});
test('sheet-name: over the limit → 429 with Retry-After, Google not contacted', async () => {
  const db = fakeDb({ over: true });
  const out = await run(sheet, { query: { url: URL_ }, headers: { authorization: 'Bearer t' } }, db.f);
  assert.equal(out.code, 429);
  assert.equal(out.headers['Retry-After'], '42');
  assert.ok(!db.tried.some((u) => u.includes('google')));
});
test('sheet-name: under the limit → the name comes back', async () => {
  const db = fakeDb({ over: false });
  const out = await run(sheet, { query: { url: URL_ }, headers: { authorization: 'Bearer t' } }, db.f);
  assert.equal(out.code, 200);
  assert.equal(out.body.name, 'My sheet');
});
