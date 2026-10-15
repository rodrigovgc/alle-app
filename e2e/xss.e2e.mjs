// Browser XSS test: harmless HTML markers in every name and card field must show as
// text, never become elements or run. Needs Playwright, a demo build of the app
// (VITE_DEMO=true) served on :4311 and the website's dist on :4320:
//   node e2e/xss.e2e.mjs <folder-for-screenshots>
// Fails (exit 1) if any marker became an element or ran.
import { chromium } from 'playwright';
const S = process.argv[2];
const M = (where) => `<b class="xss-marker" data-where="${where}">MARK</b><img src=x onerror="window.__xss=(window.__xss||[]).concat('${where}')"><svg onload="window.__xss=(window.__xss||[]).concat('svg-${where}')"></svg>`;
const uid = 'u1';
const user = { id: uid, email: 'x@example.com', user_metadata: { first_name: M('first-name'), last_name: 'Q', onboarded: true } };
const cards = Array.from({ length: 4 }, (_, i) => ({ front: M(`front${i}`), back: `answer${i}` }));
const db = {
  users: { 'x@example.com': { password: 'demo123', user, confirmed: true } },
  session: { user },
  deck_groups: [{ id: 'g1', user_id: uid, title: M('group'), position: 0, collapsed: false }],
  decks: [{ id: 'd1', user_id: uid, title: M('deck-title'), front_label: M('front-label'), back_label: M('back-label'), color: 'yellow', shape: 'yellow', cards, group_id: 'g1', created_at: new Date().toISOString() },
          { id: 'd2', user_id: uid, title: 'Plain', front_label: 'A', back_label: 'B', color: 'blue', shape: 'blue', cards, created_at: new Date().toISOString() }],
  progress: [],
};
const b = await chromium.launch();
const results = [];
async function check(page, label) {
  const r = await page.evaluate(() => ({
    elements: document.querySelectorAll('.xss-marker').length,
    ran: window.__xss || [],
    shownAsText: (document.body.innerText.match(/<b class="xss-marker"/g) || []).length,
  }));
  results.push({ label, ...r });
}
// --- App (demo build, local data only)
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.addInitScript((d) => { localStorage.setItem('alle-demo-db', JSON.stringify(d)); localStorage.setItem('alle-consent', 'denied'); }, db);
await p.goto('http://localhost:4311/'); await p.waitForTimeout(1800); await check(p, 'app: Home');
await p.screenshot({ path: `${S}/xss-home.png` });
await p.locator('.side__nav button, .side__nav a').nth(1).click(); await p.waitForTimeout(1000); await check(p, 'app: Decks');
await p.keyboard.press('Control+k').catch(() => {});
await p.locator('.deck').first().click(); await p.waitForTimeout(1500); await check(p, 'app: Study (front)');
await p.screenshot({ path: `${S}/xss-study.png` });
const input = p.locator('.study-card__input').first();
if (await input.count()) { await input.fill('nope'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200); }
else { await p.locator('.choice, .study-choice, button').filter({ hasText: 'answer' }).first().click().catch(() => {}); await p.waitForTimeout(1200); }
await check(p, 'app: Study (answer shown)');
// --- Website homepage demo builder
const w = await b.newPage({ viewport: { width: 1280, height: 860 } });
await w.goto('http://localhost:4320/'); await w.waitForTimeout(1500);
const cells = w.locator('input.cell');
for (let i = 0; i < Math.min(4, await cells.count()); i++) { await cells.nth(i).fill(`<b class="xss-marker">c${i}</b><img src=x onerror="window.__xss=(window.__xss||[]).concat('cell${i}')">`); }
for (const id of ['#g-name', '#c-name', 'input[id*=name]']) { const el = w.locator(id).first(); if (await el.count()) { await el.fill(`<b class="xss-marker">n</b><img src=x onerror="window.__xss=['name']">`).catch(() => {}); } }
await w.waitForTimeout(800); await check(w, 'website: demo builder');
await b.close();
console.table(results);
const bad = results.filter((r) => r.elements > 0 || r.ran.length > 0 || r.shownAsText === 0);
if (bad.length) { console.error('XSS CHECK FAILED', bad); process.exitCode = 1; } else console.log('all pages show the markers as text only');
