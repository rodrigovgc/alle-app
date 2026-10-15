// SSRF tests for the only server code that fetches an address a person gives
// (api/sheet-name.js). Local stand-ins only: no real network, no cloud metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { allowedUrl, safeFetch, readCapped } from '../../api/sheet-name.js';

const SHEET = 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv';

/** A fake internet: records every address the code tries, answers from a table. */
function world(routes) {
  const tried = [];
  const fetchImpl = async (url, init = {}) => {
    tried.push(url);
    if (init.signal?.aborted) throw new DOMException('timeout', 'TimeoutError');
    const r = routes(url, init);
    return typeof r === 'function' ? r(init) : r;
  };
  return { tried, fetchImpl };
}
const redirect = (to, status = 302) => new Response(null, { status, headers: { location: to } });
const csvWithName = () => new Response('a,b\n1,2', { headers: { 'content-disposition': 'attachment; filename="Dutch words - Lesson 3.csv"' } });
function call(url, fetchImpl) {
  return new Promise((resolve) => {
    const res = { code: 200, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ query: { url } }, res, fetchImpl);
  });
}

test('links to anything but Google Sheets are refused before any request', async () => {
  const bad = [
    'http://docs.google.com/spreadsheets/d/x/pub',             // not https
    'https://127.0.0.1/spreadsheets/d/x/pub',                  // loopback
    'https://localhost/spreadsheets/d/x/pub',
    'https://[::1]/spreadsheets/d/x/pub',                      // IPv6 loopback
    'https://[::ffff:127.0.0.1]/spreadsheets/d/x/pub',         // IPv4 hidden in IPv6
    'https://169.254.169.254/latest/meta-data/',               // cloud metadata address (never contacted)
    'https://10.0.0.5/spreadsheets/d/x', 'https://192.168.1.1/spreadsheets/d/x', // private networks
    'https://docs.google.com@127.0.0.1/spreadsheets/d/x',      // user-info trick
    'https://docs.google.com.evil.example/spreadsheets/d/x',   // look-alike host
    'https://docs.google.com:8443/spreadsheets/d/x/pub',       // other port
    'https://docs.google.com./spreadsheets/d/x/pub',           // trailing dot
    'https://2130706433/spreadsheets/d/x',                     // 127.0.0.1 as a number
    'file:///etc/passwd', 'gopher://docs.google.com/', 'not a url',
    'https://docs.google.com/document/d/x',                    // Google, but not a sheet
  ];
  for (const url of bad) {
    const { tried, fetchImpl } = world(() => { throw new Error('must not be called'); });
    const out = await call(url, fetchImpl);
    assert.equal(out.code, 400, url);
    assert.equal(tried.length, 0, `${url} reached the network`);
  }
});

test('redirects to private, loopback, IPv6, metadata or other hosts are not followed', async () => {
  const targets = [
    'http://169.254.169.254/latest/meta-data/', 'https://169.254.169.254/', 'https://127.0.0.1/', 'https://localhost:3000/',
    'https://[::1]/', 'https://[fd00::1]/', 'https://10.1.2.3/', 'https://172.16.0.1/', 'https://192.168.0.1/',
    'https://evil.example/', 'http://doc-0s.googleusercontent.com/', 'https://doc.googleusercontent.com.evil.example/',
    '//127.0.0.1/', '/\\127.0.0.1/',
  ];
  for (const to of targets) {
    const { tried, fetchImpl } = world((url) => (url.startsWith('https://docs.google.com/') ? redirect(to) : new Response('reached')));
    const out = await call(SHEET, fetchImpl);
    assert.equal(out.body.name, null, to);
    assert.ok(tried.every((u) => allowedUrl(u)), `followed to ${tried.find((u) => !allowedUrl(u))}`);
  }
});

test('a redirect chain is cut off; normal Google redirects still work', async () => {
  let n = 0;
  const loop = world(() => redirect(`https://docs.google.com/spreadsheets/d/e/x/pub?hop=${n++}`));
  assert.equal((await call(SHEET, loop.fetchImpl)).body.name, null);
  assert.ok(loop.tried.length <= 10, `made ${loop.tried.length} requests`);

  const google = world((url) => (url.startsWith('https://docs.google.com/')
    ? redirect('https://doc-0s-8c-sheets.googleusercontent.com/pub/abc?output=csv', 307)
    : csvWithName()));
  const ok = await call(SHEET, google.fetchImpl);
  assert.equal(ok.body.name, 'Lesson 3');
});

test('slow destinations time out', async () => {
  const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
  const { fetchImpl } = world(() => hang);
  const started = Date.now();
  const ctrl = new AbortController(); setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), 300);
  const out = await safeFetch(SHEET, ctrl.signal, fetchImpl).then(() => 'answered', (e) => e.name);
  assert.equal(out, 'TimeoutError');
  assert.ok(Date.now() - started < 2000);
});

test('huge responses are read only up to the limit', async () => {
  let sent = 0;
  const endless = new ReadableStream({ pull(c) { sent += 65536; c.enqueue(new Uint8Array(65536).fill(97)); } });
  const text = await readCapped(new Response(endless), 512 * 1024);
  assert.equal(text.length, 512 * 1024);
  assert.ok(sent <= 512 * 1024 + 65536 * 2, `pulled ${sent} bytes`);
});
