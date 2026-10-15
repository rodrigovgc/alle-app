// Error-response tests for the server functions: a forced crash must give a plain 500
// with a requestId and no details; the log line must carry the same requestId with
// secrets masked; and ordinary problems must keep their own status (400/401/405/429/502).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.VITE_SUPABASE_URL = 'https://db.test';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
process.env.VERCEL_ENV = 'production';
const { default: ai } = await import('../../api/generate-deck.js');
const { default: sheet } = await import('../../api/sheet-name.js');
const { mask } = await import('../../api/_errors.js');

const SECRETS = /eyJhbGciOi|sk-ant-live|alice@example\.com|hunter2|\/var\/task|at handler|ECONNREFUSED|stack/i;
function run(handler, req, fetchImpl) {
  return new Promise((resolve) => {
    const res = { headersSent: false, code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.headersSent = true; resolve({ code: this.code, body: b, headers: this.headers }); } };
    handler(req, res, fetchImpl);
  });
}
async function capture(fn) {
  const lines = []; const e = console.error; const w = console.warn;
  console.error = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' '));
  try { return { out: await fn(), lines }; } finally { console.error = e; console.warn = w; }
}
const crash = async () => {
  const err = new TypeError('connect ECONNREFUSED 10.0.0.3:5432 while sending Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln for alice@example.com password=hunter2 key sk-ant-live-123');
  err.stack = 'TypeError: ...\n    at handler (/var/task/api/generate-deck.js:1:1)';
  throw err;
};

test('forced crash → 500 with only {error, requestId}; log has the same requestId, secrets masked', async () => {
  const real = globalThis.fetch; globalThis.fetch = crash;
  try {
    const { out, lines } = await capture(() => run(ai, { method: 'POST', headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', 'x-vercel-id': 'fra1::abc123-1700000000000' }, body: {} }));
    assert.equal(out.code, 500);
    assert.deepEqual(Object.keys(out.body).sort(), ['error', 'requestId']);
    assert.equal(out.body.error, 'server_error');
    assert.equal(out.body.requestId, 'fra1::abc123-1700000000000');
    assert.equal(out.headers['X-Request-Id'], 'fra1::abc123-1700000000000');
    assert.doesNotMatch(JSON.stringify(out), SECRETS);
    assert.equal(lines.length, 1);
    const log = JSON.parse(lines[0]);
    assert.equal(log.requestId, 'fra1::abc123-1700000000000');
    assert.equal(log.route, 'generate-deck');
    assert.doesNotMatch(lines[0], /eyJhbGciOi|sk-ant-live|alice@example\.com|hunter2/);
    assert.match(lines[0], /Bearer \[masked\]/);
  } finally { globalThis.fetch = real; }
});

test('the AI service failing → 502 ai_failed with a requestId, key never logged', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u1', email: 'u1@test' }));
    if (String(url).endsWith('/rpc/hit_limit')) return new Response(JSON.stringify({ ok: true }));
    if (String(url).includes('/ai_generations')) return new Response(null, { headers: { 'content-range': '0-0/0' } });
    throw new Error('upstream refused key sk-ant-live-999');
  };
  try {
    const { out, lines } = await capture(() => run(ai, { method: 'POST', headers: { authorization: 'Bearer t' }, body: { spec: {} } }));
    assert.equal(out.code, 502);
    assert.equal(out.body.error, 'ai_failed');
    assert.ok(out.body.requestId);
    assert.doesNotMatch(lines.join('\n'), /sk-ant-live-999/);
  } finally { globalThis.fetch = real; }
});

test('ordinary problems keep their own status, never a 500', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return new Response('{}', { status: 401 });
    return new Response('{}');
  };
  try {
    assert.equal((await run(ai, { method: 'POST', headers: {}, body: {} })).code, 401);                         // no sign-in
    assert.equal((await run(ai, { method: 'POST', headers: { authorization: 'Bearer bad' }, body: {} })).code, 401); // bad sign-in
  } finally { globalThis.fetch = real; }
  const okUser = async (url) => (String(url).endsWith('/auth/v1/user') ? new Response(JSON.stringify({ id: 'u', email: 'u@t' }))
    : String(url).includes('/ai_generations') ? new Response(null, { headers: { 'content-range': '0-0/0' } })
    : new Response(JSON.stringify({ ok: true })));
  globalThis.fetch = okUser;
  try {
    assert.equal((await run(ai, { method: 'DELETE', headers: { authorization: 'Bearer t' } })).code, 405);           // wrong method
    assert.equal((await run(ai, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{not json' })).code, 400); // bad JSON
    assert.equal((await run(ai, { method: 'POST', headers: { authorization: 'Bearer t' }, body: { spec: 'x' } })).code, 400); // wrong type
  } finally { globalThis.fetch = real; }
  assert.equal((await run(sheet, { query: { url: 'https://evil.example/' }, headers: {} }, okUser)).code, 400);    // bad link
  assert.equal((await run(sheet, { query: { url: 'https://docs.google.com/spreadsheets/d/x/pub' }, headers: {} }, okUser)).code, 401); // signed out
});

test('mask() hides tokens, keys, emails and passwords', () => {
  const m = mask('Bearer abc.def password: "p@ss" sk-ant-xyz bob@site.org eyJa1234567890123456789.eyJb1234567890123456789.sig');
  assert.doesNotMatch(m, /abc\.def|p@ss|sk-ant-xyz|bob@site\.org|eyJa/);
});

test('the app shows plain words for database errors, never table or rule names', async () => {
  const { plainDbError } = await import('./dbErrors.js');
  const cases = {
    'new row violates check constraint "decks_title_len" for relation "decks"': /too long or not allowed/,
    'new row violates row-level security policy for table "decks"': /sign-in expired/,
    'permission denied for table rate_hits': /sign-in expired/,
    'TypeError: Failed to fetch': /Couldn’t reach Alle/,
    'weird internal thing at /var/task/x.js': /Something went wrong/,
  };
  for (const [raw, shown] of Object.entries(cases)) {
    const e = plainDbError({ message: raw, code: '23514' });
    assert.match(e.message, shown, raw);
    assert.doesNotMatch(e.message, /decks|rate_hits|constraint|relation|policy|var\/task/i);
    assert.equal(e.raw, raw); // kept for the app's own checks, not shown
  }
});
