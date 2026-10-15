// XSS regression tests. The app relies on React escaping text, so: (1) no code may insert
// raw HTML, and (2) the one hand-written HTML page (api/share.js, the share-link preview)
// must escape deck names. The browser check is e2e/xss.e2e.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(jsx?|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

test('no raw HTML insertion anywhere in the app or server code', () => {
  const risky = /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write|new Function\(|\beval\(/;
  const hits = [...files('src'), ...files('api')].filter((f) => risky.test(readFileSync(f, 'utf8')));
  assert.deepEqual(hits, [], `raw HTML found in: ${hits.join(', ')} (use text, or sanitise and add a test)`);
});

test('share-link page escapes a hostile deck name', async () => {
  process.env.VITE_SUPABASE_URL = 'https://db.test';
  process.env.VITE_SUPABASE_ANON_KEY = 'anon';
  const M = '</title><b class="xss-marker">MARK</b><img src=x onerror="alert(1)">"><script>alert(2)</script>';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ title: M, front_label: M, back_label: M, color: 'blue', shape: 'blue', card_count: 3 }]));
  try {
    const { default: share } = await import('../../api/share.js');
    const html = await (await share(new Request('https://my.allecards.app/api/share?code=12345678-1234-1234-1234-123456789abc'))).text();
    assert.doesNotMatch(html, /<b class="xss-marker"|<img src=x|<script>alert|onerror="alert/);
    assert.match(html, /&lt;b class=&quot;xss-marker&quot;&gt;MARK/);
    // A share code that isn't a real code never reaches the page
    const bad = await share(new Request('https://my.allecards.app/api/share?code=%22%3E%3Cscript%3Ealert(1)%3C/script%3E'));
    assert.equal(bad.status, 302);
  } finally {
    globalThis.fetch = realFetch;
  }
});
