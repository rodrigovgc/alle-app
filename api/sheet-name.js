// Vercel function: returns the name of a published Google Sheet.
//
// Browsers can't read the name themselves: Google sends it in a download header
// that's hidden from web pages. Here on the server nothing is hidden, so we ask
// Google for the sheet and return just its name. Only Google Sheets links are
// accepted, so this can't be used to fetch anything else.

const GENERIC_TAB = /^(sheet|blad|feuille|hoja|planilha|página|pagina|tabelle|foglio|arkusz)\s*\d+$/i;

function nameFromDisposition(header) {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plain = header.match(/filename\s*=\s*"([^"]+)"/i) || header.match(/filename\s*=\s*([^;]+)/i);
  let raw = star ? decodeURIComponent(star[1]) : plain ? plain[1] : null;
  if (!raw) return null;
  raw = raw.trim().replace(/\.csv$/i, '');
  if (/^(data|export|output|download|sheet)$/i.test(raw)) return null; // not a real name
  // Google names the file "Spreadsheet name - Tab name". A tab is often the
  // most specific name (one tab per lesson), unless it's the default "Sheet1".
  const parts = raw.split(' - ');
  if (parts.length >= 2) {
    const tab = parts.pop().trim();
    const title = parts.join(' - ').trim();
    return GENERIC_TAB.test(tab) ? title : tab;
  }
  return raw;
}

function nameFromHtml(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  if (!m) return null;
  return m[1].replace(/\s*-\s*Google (Sheets|Drive|Spreadsheets)\s*$/i, '').trim() || null;
}

// Some Google pages answer differently to bare server requests; look like a browser.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept-Language': 'en',
};

// Where this function may connect. Only Google's own sheet servers: a person's link
// can't point it anywhere else, and neither can a redirect.
const ALLOWED_HOST = (h) => h === 'docs.google.com' || /^[a-z0-9-]+\.googleusercontent\.com$/.test(h);
export function allowedUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && p.port === '' && !p.username && !p.password && ALLOWED_HOST(p.hostname);
  } catch { return false; }
}
const TIME_LIMIT_MS = 6000;      // the whole lookup, all requests and redirects together
const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 512 * 1024; // the <title> is near the top; never read more than this

/** fetch() that only goes to allowed hosts, checks every redirect itself, and stops on time. */
export async function safeFetch(url, signal, fetchImpl = fetch) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedUrl(current)) throw new Error('blocked destination');
    const res = await fetchImpl(current, { redirect: 'manual', headers: HEADERS, signal });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel?.().catch(() => {});
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return { res, finalUrl: current };
  }
  throw new Error('too many redirects');
}

/** The start of a response body as text, never more than `max` bytes. */
export async function readCapped(res, max = MAX_HTML_BYTES) {
  if (!res.body?.getReader) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;

/** Signed-in people only, and a limit per person (supabase/015_rate_limits.sql). */
async function allowed(req, fetchImpl) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SB_URL || !SB_KEY) return { ok: false, status: 401 };
  try {
    const r = await fetchImpl(`${SB_URL}/rest/v1/rpc/hit_limit`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'sheet' }),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401 };
    if (r.ok) {
      const out = await r.json();
      if (out?.reason === 'signed_out') return { ok: false, status: 401 };
      if (out && out.ok === false) return { ok: false, status: 429, retry: out.retry_after || 60 };
      return { ok: true };
    }
    // 015 not run yet: at least make sure the sign-in is real
    const u = await fetchImpl(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } });
    return u.ok ? { ok: true } : { ok: false, status: 401 };
  } catch { return { ok: false, status: 503 }; }
}

export default async function handler(req, res, fetchImpl = fetch) {
  const url = String(req.query.url || '');
  const debug = req.query.debug === '1' && process.env.VERCEL_ENV !== 'production'; // details only on test builds
  const trace = [];
  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).json({ name: null }); }
  if (!allowedUrl(url) || parsed.hostname !== 'docs.google.com' || !parsed.pathname.startsWith('/spreadsheets/')) {
    return res.status(400).json({ name: null });
  }

  const gate = await allowed(req, fetchImpl);
  if (!gate.ok) {
    if (gate.retry) res.setHeader('Retry-After', String(gate.retry));
    return res.status(gate.status).json({ name: null, error: gate.status === 429 ? 'rate' : gate.status === 401 ? 'signed_out' : 'unavailable' });
  }
  res.setHeader('Cache-Control', 'private, no-store');
  const signal = AbortSignal.timeout(TIME_LIMIT_MS);
  try {
    // 1. The CSV download's file name: "Spreadsheet - Tab.csv"
    const { res: csv, finalUrl: csvUrl } = await safeFetch(url, signal, fetchImpl);
    csv.body?.cancel?.().catch(() => {}); // only the headers are needed, never the sheet itself
    const disposition = csv.headers.get('content-disposition');
    trace.push({ step: 'csv', status: csv.status, finalUrl: csvUrl, contentType: csv.headers.get('content-type'), disposition });
    const fromHeader = nameFromDisposition(disposition);
    if (fromHeader) return res.status(200).json(debug ? { name: fromHeader, trace } : { name: fromHeader });

    // 2. The published web page's title
    const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)\//);
    const htmlUrl = /\/d\/e\//.test(url)
      ? url.replace(/\/pub\?[^#]*/, '/pubhtml')                       // published link
      : id ? `https://docs.google.com/spreadsheets/d/${id[1]}/htmlview` // shared link
        : url;
    if (htmlUrl !== url) {
      const { res: page, finalUrl: pageUrl } = await safeFetch(htmlUrl, signal, fetchImpl);
      const html = page.ok ? await readCapped(page) : '';
      const titleTag = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || null;
      trace.push({ step: 'html', url: htmlUrl, status: page.status, finalUrl: pageUrl, titleTag });
      const fromTitle = nameFromHtml(html);
      if (fromTitle) return res.status(200).json(debug ? { name: fromTitle, trace } : { name: fromTitle });
    }
  } catch (err) {
    trace.push({ step: 'error', message: String(err && err.message || err) });
  }
  return res.status(200).json(debug ? { name: null, trace } : { name: null });
}
