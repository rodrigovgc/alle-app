// Parse a published Google Sheet (CSV). Two columns: A = front, B = back.
// First row is the header and names the two sides of the deck.

/** RFC 4180-ish parser: handles quoted cells, escaped quotes, CRLF, newlines in quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Turn a normal Sheets link into a CSV endpoint. Published links pass through. */
export function toCsvUrl(input) {
  const url = input.trim();
  if (/output=csv|format=csv|tqx=out:csv/.test(url)) return url;
  const pub = url.match(/\/spreadsheets\/d\/e\/([^/]+)\/pub/);
  if (pub) return url.replace(/pubhtml.*$|pub\?.*$|pub$/, 'pub?output=csv');
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (id) {
    const gid = url.match(/[#&?]gid=(\d+)/);
    return `https://docs.google.com/spreadsheets/d/${id[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid[1]}` : ''}`;
  }
  return url;
}

export class DeckImportError extends Error {}

/** Rows → { frontLabel, backLabel, cards: [{ front, back }] } */
export function rowsToDeck(rows) {
  const clean = rows.map((r) => r.map((c) => (c ?? '').trim()));
  const header = clean[0];
  if (!header || header.length < 2 || !header[0] || !header[1]) {
    throw new DeckImportError('The first row needs two headers, like "English" and "Dutch".');
  }
  const seen = new Set();
  const cards = [];
  for (const [front = '', back = ''] of clean.slice(1)) {
    if (!front || !back) continue;
    const key = front.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ front, back });
  }
  if (!cards.length) {
    throw new DeckImportError('No cards found. Fill columns A and B under the header row.');
  }
  return { frontLabel: header[0], backLabel: header[1], cards };
}

export async function fetchDeckFromUrl(input) {
  const url = toCsvUrl(input);
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new DeckImportError('That link couldn’t be reached. Check that the sheet is published to the web.');
  }
  if (!res.ok) {
    throw new DeckImportError('That link couldn’t be opened. Publish the sheet as CSV and paste the new link.');
  }
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new DeckImportError('That link opens a web page, not a CSV. In “Publish to web”, choose CSV.');
  }
  return { ...rowsToDeck(parseCSV(text)), csvUrl: input.trim() };
}

/* ---- Cell helpers ------------------------------------------------------ */

/** Pipe = alternative accepted answers. */
export const alternatives = (cell) =>
  cell.split('|').map((s) => s.trim()).filter(Boolean);

/** Bullet = line break when displayed. */
export const displayLines = (text) =>
  text.split('•').map((s) => s.trim()).filter(Boolean);

/**
 * Reads cards pasted from an AI chat. Accepts CSV (with or without a
 * ```code fence```), tab-separated rows (pasted from a spreadsheet), or a
 * Markdown table. First row is always the header.
 */
export function parseLooseTable(input) {
  let text = input.replace(/\r\n?/g, '\n').trim();
  const fence = text.match(/```[a-z]*\n([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const lines = text.split('\n').filter((l) => l.trim());
  if (!lines.length) throw new DeckImportError('Paste the cards your AI made.');

  let rows;
  if (lines[0].trim().startsWith('|')) {
    rows = lines
      .filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))           // skip |---|---|
      .map((l) => {
        const inner = l.trim().replace(/^\||\|$/g, '');
        // Cells are split on " | "; a bare "|" inside a cell stays an alternative answer.
        return (inner.includes(' | ') ? inner.split(/\s+\|\s+/) : inner.split('|')).map((c) => c.trim());
      });
    // A Markdown row has exactly two cells here; anything else, fall back.
    if (rows.some((r) => r.length !== 2)) rows = null;
  }
  if (!rows && lines[0].includes('\t')) rows = lines.map((l) => l.split('\t'));
  if (!rows) rows = parseCSV(lines.join('\n'));

  return rowsToDeck(rows);
}

/**
 * The sheet's own name, via the /api/sheet-name function (browsers can't read
 * it directly). Resolves to null when it can't be found; never throws.
 */
export async function fetchSheetName(input) {
  const url = toCsvUrl(input || '');
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(url)) return null;
  try {
    const { supabase } = await import('./supabase.js'); // loaded here so the parsing code stays testable on its own
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const res = await fetch(`/api/sheet-name?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const { name } = await res.json();
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}
