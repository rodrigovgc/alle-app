// Vercel function: makes a deck's cards with Alle's own AI (Claude), so people
// don't have to copy a prompt into another app.
//
//   GET  /api/generate-deck  → { limit, left, enabled }         (how many free AI decks are left)
//   POST /api/generate-deck  { spec } → { cards, left, preview } (the builder's choices in, cards out)
//
// Only signed-in people can use it (their Supabase session is checked here), each
// person gets AI_MONTHLY_FREE decks a month, and the AI key never leaves the server.
// Without ANTHROPIC_API_KEY, test builds (Vercel "preview") return pretend cards so
// the screens can be tried; the live app says AI isn't available yet.

import { buildAppPrompt, LEVELS, SIZES } from '../src/lib/prompt.js';
import { withErrors, logEvent } from './_errors.js';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const AI_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const LIMIT = Number(process.env.AI_MONTHLY_FREE || 3);
const UNLIMITED = (process.env.AI_UNLIMITED_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const IS_PREVIEW = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development';

const sb = (path, token, init = {}) => fetch(`${SB_URL}${path}`, {
  ...init,
  headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

async function signedInUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !SB_URL || !SB_KEY) return null;
  const res = await sb('/auth/v1/user', token);
  if (!res.ok) return null;
  const user = await res.json();
  return user?.id ? { user, token } : null;
}

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); };

/**
 * Short-term limit, shared by every copy of this function (supabase/015_rate_limits.sql).
 * Returns { ok, retry_after }. If 015 hasn't been run yet, it lets the request through.
 */
export async function hitLimit(bucket, token, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${SB_URL}/rest/v1/rpc/hit_limit`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket }),
    });
    if (res.status === 401) return { ok: false, reason: 'signed_out' };
    if (!res.ok) return { ok: true, unchecked: true };
    const out = await res.json();
    return out && typeof out === 'object' ? out : { ok: true, unchecked: true };
  } catch { return { ok: true, unchecked: true }; }
}

/** AI decks made this month; null if the table isn't there yet (012_ai_decks.sql not run). */
async function usedThisMonth(token) {
  const res = await sb(`/rest/v1/ai_generations?select=id&created_at=gte.${encodeURIComponent(monthStart())}`, token, {
    method: 'HEAD', headers: { Prefer: 'count=exact' },
  });
  if (!res.ok) return null;
  const range = res.headers.get('content-range') || '';
  return Number(range.split('/')[1] || 0);
}

// Keep the builder's choices short and sane before they go into the request
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function cleanSpec(input) {
  const s = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return {
    subject: clip(s.subject, 20), known: clip(s.known, 40), learning: clip(s.learning, 40),
    topic: clip(s.topic, 200), focus: clip(s.focus, 200),
    front: clip(s.front, 40) || 'Front', back: clip(s.back, 40) || 'Back',
    frontHint: clip(s.frontHint, 160), backHint: clip(s.backHint, 160),
    count: SIZES.includes(Number(s.count)) ? Number(s.count) : 20,
    level: LEVELS.includes(s.level) ? s.level : 'Beginner',
    alternatives: Boolean(s.alternatives),
  };
}

/** Cards from the AI, checked: two short sides, no empty or repeated fronts, the size asked for. */
export function cleanCards(list, count) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const front = clip(c?.front, 200);
    const back = clip(c?.back, 200);
    const key = front.toLowerCase();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    out.push({ front, back });
    if (out.length >= count) break;
  }
  return out;
}

const TOOL = {
  name: 'save_flashcards',
  description: 'Save the flashcards for the deck.',
  input_schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: { front: { type: 'string' }, back: { type: 'string' } },
          required: ['front', 'back'],
        },
      },
    },
    required: ['cards'],
  },
};

async function askClaude(spec) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: spec.count > 50 ? 8000 : 4000,
      system: 'You write accurate, concise flashcards for Alle, a flashcard app. Follow the format exactly. Never add commentary.',
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: buildAppPrompt(spec) }],
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status})`);
  const data = await res.json();
  // Only Alle's one tool counts; anything else the model sends (text, other tool names) is ignored
  const call = (data.content || []).find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  return call?.input?.cards || [];
}

/** Pretend cards for test builds without an AI key, so the flow can be tried. */
function previewCards(spec) {
  const n = Math.min(spec.count, 20);
  return Array.from({ length: n }, (_, i) => ({
    front: `${spec.front} example ${i + 1}`,
    back: `${spec.back} example ${i + 1}`,
  }));
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const who = await signedInUser(req);
  if (!who) return res.status(401).json({ error: 'signed_out' });
  const unlimited = UNLIMITED.includes((who.user.email || '').toLowerCase());
  const enabled = Boolean(AI_KEY) || IS_PREVIEW;
  const used = await usedThisMonth(who.token);
  const left = unlimited ? 999 : Math.max(0, LIMIT - (used ?? 0));

  if (req.method === 'GET') return res.status(200).json({ limit: LIMIT, left, enabled });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  if (!enabled) return res.status(503).json({ error: 'not_available' });
  if (!unlimited && left <= 0) return res.status(429).json({ error: 'limit', limit: LIMIT, left: 0 });
  // A few AI decks a minute at most, even for unlimited accounts (each one costs money)
  const burst = await hitLimit('ai', who.token);
  if (!burst.ok) {
    res.setHeader('Retry-After', String(burst.retry_after || 60));
    return res.status(429).json({ error: 'rate', retry_after: burst.retry_after || 60 });
  }

  // Only the builder's known choices are used (extra fields are dropped); bad JSON is a 400, not a crash
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { return res.status(400).json({ error: 'bad_request' }); }
  if (!body || typeof body !== 'object' || (body.spec != null && typeof body.spec !== 'object')) return res.status(400).json({ error: 'bad_request' });
  const spec = cleanSpec(body.spec);
  try {
    const preview = !AI_KEY;
    const cards = cleanCards(preview ? previewCards(spec) : await askClaude(spec), spec.count);
    if (!cards.length) return res.status(502).json({ error: 'empty' });
    // Count it (also for pretend cards, so the limit can be tried on test builds)
    if (used !== null) {
      await sb('/rest/v1/ai_generations', who.token, {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ cards: cards.length, model: preview ? 'preview' : MODEL }),
      }).catch(() => {});
    }
    return res.status(200).json({ cards, left: unlimited ? 999 : Math.max(0, left - 1), preview });
  } catch (err) {
    logEvent('warn', 'generate-deck', req.requestId, { error: 'ai_failed', message: err?.message || '' });
    return res.status(502).json({ error: 'ai_failed', requestId: req.requestId });
  }
}

export default withErrors('generate-deck', handler);
