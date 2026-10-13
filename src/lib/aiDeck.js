// Alle's own AI: asks api/generate-deck.js for a deck's cards.
// Demo mode (no server) makes pretend cards here, so the screens can be tried locally.
import { supabase, isDemo } from './supabase.js';

const DEMO_KEY = 'alle-demo-ai-used';
const DEMO_LIMIT = 3;

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** { limit, left, enabled } — how many free AI decks are left this month. */
export async function aiAllowance() {
  if (isDemo) {
    const used = Number(localStorage.getItem(DEMO_KEY) || 0);
    return { limit: DEMO_LIMIT, left: Math.max(0, DEMO_LIMIT - used), enabled: true };
  }
  try {
    const res = await fetch('/api/generate-deck', { headers: await authHeader() });
    if (!res.ok) return { limit: 0, left: 0, enabled: false };
    return await res.json();
  } catch { return { limit: 0, left: 0, enabled: false }; }
}

export class AiDeckError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** The builder's choices in, cards out: { cards: [{front, back}], left, preview }. */
export async function generateCards(spec) {
  if (isDemo) {
    const used = Number(localStorage.getItem(DEMO_KEY) || 0);
    if (used >= DEMO_LIMIT) throw new AiDeckError('limit');
    await new Promise((r) => setTimeout(r, 1400));
    localStorage.setItem(DEMO_KEY, String(used + 1));
    const n = Math.min(spec.count, 20);
    return {
      cards: Array.from({ length: n }, (_, i) => ({ front: `${spec.front} example ${i + 1}`, back: `${spec.back} example ${i + 1}` })),
      left: DEMO_LIMIT - used - 1,
      preview: true,
    };
  }
  let res;
  try {
    res = await fetch('/api/generate-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ spec }),
    });
  } catch { throw new AiDeckError('offline'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiDeckError(data.error || 'ai_failed');
  return data;
}
