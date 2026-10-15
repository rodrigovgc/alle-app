// Error handling for the server functions: every response gets an X-Request-Id; an
// unexpected failure becomes a plain 500 {"error":"server_error","requestId"} with no
// details, and one log line (visible only in Vercel's logs) with the same requestId,
// with tokens, keys, emails and passwords masked.
import { randomUUID } from 'node:crypto';

const MASKS = [
  [/Bearer\s+[\w.-]+/gi, 'Bearer [masked]'],
  [/sk-ant-[\w-]+/g, 'sk-ant-[masked]'],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt masked]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email masked]'],
  [/("?(password|token|apikey|api_key|secret|authorization)"?\s*[:=]\s*)"?[^"\s,}]+/gi, '$1[masked]'],
];
export const mask = (s) => MASKS.reduce((t, [re, to]) => t.replace(re, to), String(s ?? '')).slice(0, 300);

export function requestIdOf(req) {
  const h = req?.headers?.['x-vercel-id'] || req?.headers?.['x-request-id'];
  return /^[\w:.-]{6,120}$/.test(h || '') ? h : randomUUID();
}

/** One structured log line. Never pass request bodies or headers in here. */
export function logEvent(level, route, requestId, info = {}) {
  const line = { level, route, requestId };
  for (const [k, v] of Object.entries(info)) line[k] = typeof v === 'string' ? mask(v) : v;
  (level === 'error' ? console.error : console.warn)(JSON.stringify(line));
}

/** Wrap a Node-style (req, res) handler. */
export function withErrors(route, handler) {
  return async function wrapped(req, res, ...rest) {
    const requestId = requestIdOf(req);
    res.setHeader('X-Request-Id', requestId);
    req.requestId = requestId;
    try {
      return await handler(req, res, ...rest);
    } catch (err) {
      logEvent('error', route, requestId, { error: err?.name || 'Error', message: err?.message || String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'server_error', requestId });
      return undefined;
    }
  };
}
