// Access matrix for the owner-only (admin) functions and other sensitive endpoints,
// end to end through PostgREST. TEST DATABASE ONLY. The owner in the test database is
// the placeholder email in 005_analytics.sql (rodrigovgc@example.com).
//   PGRST_URL=http://localhost:3901 PGRST_JWT_SECRET=... node supabase/tests/admin_access.e2e.mjs
import { createHmac } from 'node:crypto';

const URL = process.env.PGRST_URL || 'http://localhost:3901';
const SECRET = process.env.PGRST_JWT_SECRET;
if (!SECRET) throw new Error('Set PGRST_JWT_SECRET');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64({ exp: Math.floor(Date.now() / 1000) + 600, ...claims });
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const WHO = {
  'signed out': jwt({ role: 'anon' }),
  'normal user': jwt({ role: 'authenticated', sub: '11111111-1111-1111-1111-111111111111', email: 'user@test' }),
  'user claiming admin': jwt({ role: 'authenticated', sub: '11111111-1111-1111-1111-111111111111', email: 'user@test', user_metadata: { role: 'admin', is_admin: true }, app_role: 'admin' }),
  owner: jwt({ role: 'authenticated', sub: '99999999-9999-9999-9999-999999999999', email: 'rodrigovgc@example.com' }),
};
async function call(token, method, path, body) {
  const res = await fetch(`${URL}${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const t = await res.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: res.status, body: j };
}
const gotData = (r) => r.status === 200 && r.body !== null && !(Array.isArray(r.body) && r.body.length === 0);
const verdict = (r) => (r.status === 401 || r.status === 403 || r.status === 404 ? `denied (${r.status})` : gotData(r) ? 'DATA' : `nothing (${r.status} ${JSON.stringify(r.body).slice(0, 12)})`);

const ROUTES = [
  ['dash_insights (dashboard numbers, people list)', 'POST', '/rpc/dash_insights', { days: 30 }, 'owner'],
  ['dash_more (dashboard extra numbers)', 'POST', '/rpc/dash_more', { days: 30 }, 'owner'],
  ['dash_overview (old dashboard)', 'POST', '/rpc/dash_overview', {}, 'owner'],
  ['dash_events (old dashboard)', 'POST', '/rpc/dash_events', {}, 'owner'],
  ['dash_activity (old dashboard)', 'POST', '/rpc/dash_activity', {}, 'owner'],
  ['stats_overview view, read directly', 'GET', '/stats_overview', null, 'nobody'],
  ['events table, read directly', 'GET', '/events', null, 'nobody'],
  ['rate_hits table, read directly', 'GET', '/rate_hits', null, 'nobody'],
  ['is_owner() called directly', 'POST', '/rpc/is_owner', {}, 'special'],
];

let failed = 0;
const rows = [];
for (const [name, method, path, body, who] of ROUTES) {
  const row = { endpoint: name };
  for (const [label, token] of Object.entries(WHO)) {
    const r = await call(token, method, path, body);
    row[label] = verdict(r);
    const shouldHaveData = (who === 'owner' && label === 'owner');
    if (path === '/rpc/is_owner') {
      // Either refused, or a plain true/false that is true only for the owner
      const ok = r.status >= 400 || r.body === (label === 'owner');
      row[label] = r.status >= 400 ? `denied (${r.status})` : String(r.body);
      if (!ok) { failed++; row[label] += ' ✗'; }
    } else if (gotData(r) !== shouldHaveData) { failed++; row[label] += ' ✗'; }
  }
  rows.push(row);
}
console.table(rows);
console.log(failed ? `${failed} unexpected result(s)` : 'access matrix as expected: only the owner gets dashboard data');
process.exitCode = failed ? 1 : 0;
