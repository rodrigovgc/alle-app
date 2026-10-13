// Pretend numbers for the Insights page in demo mode (VITE_DEMO=true). Never used in production.
const day = (i, n) => new Date(Date.now() - (n - 1 - i) * 86400000).toISOString().slice(0, 10);
const wave = (i, a, b) => Math.max(0, Math.round(a + b * Math.sin(i / 2.3) + (i % 5)));

export function demoInsights(days) {
  const n = Math.min(days, 90);
  const daily = Array.from({ length: n }, (_, i) => ({ day: day(i, n), active: wave(i, 6, 3), reviews: wave(i, 120, 70), signups: i % 4 === 0 ? 1 + (i % 3) : 0, decks: wave(i, 2, 2) }));
  const people = ['Rodrigo Varejão', 'Ana Silva', 'Tom Peeters', 'Lena Maes', 'Sam Janssens', 'Inès Dubois'];
  const users = people.map((name, i) => ({
    name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, joined: new Date(Date.now() - (i * 9 + 2) * 86400000).toISOString(),
    last_sign_in: new Date(Date.now() - i * 3600000 * 7).toISOString(), last_active: new Date(Date.now() - i * 3600000 * 5).toISOString(),
    active_days: 20 - i * 3, decks: 7 - i, reviews: 1200 - i * 190, sessions: 60 - i * 9, minutes: 300 - i * 45,
    deck_list: [{ title: '1. Wie ben jij', labels: 'English → Dutch', cards: 130, source: 'sheet', shared: i === 0, created_at: new Date().toISOString() }],
  }));
  return {
    data: {
      generated_at: new Date().toISOString(), days: n,
      kpis: { users: 42, users_new: 9, users_new_prev: 6, active: 17, active_prev: 14, decks: 160, decks_new: 31, decks_new_prev: 24, reviews: 4210, reviews_prev: 3600, sessions: 410, sessions_left: 52, correct: 2950, reviews_scored: 4100, minutes: 1380, minutes_prev: 1150, shared_decks: 6, cards_known: 2300 },
      daily,
      funnel: [{ step: 'Signed up', n: 42 }, { step: 'Added a deck', n: 31 }, { step: 'Studied', n: 26 }, { step: 'Came back another day', n: 18 }, { step: 'Shared a deck', n: 5 }],
      sources: [{ source: 'sheet', decks: 70, people: 12 }, { source: 'ready_made', decks: 41, people: 22 }, { source: 'ai_or_paste', decks: 33, people: 14 }, { source: 'shared', decks: 16, people: 7 }],
      ready_made: [{ title: 'Road signs', people: 11 }, { title: 'Flags of the world', people: 8 }, { title: 'Basic French', people: 6 }],
      ai_subjects: [{ subject: 'language', n: 21 }, { subject: 'science', n: 7 }, { subject: 'history', n: 4 }],
      languages: [{ lang: 'nl-NL', n: 64 }, { lang: 'fr-FR', n: 28 }, { lang: 'pt-BR', n: 17 }, { lang: 'en-US', n: 51 }],
      recent_decks: [{ title: 'Dutch verbs', labels: 'English → Dutch', cards: 40, source: 'ai_or_paste', who: 'Ana Silva', created_at: new Date().toISOString() }],
      top_decks: [{ title: '1. Wie ben jij', reviews: 1830, cards: 130, source: 'sheet', who: 'Rodrigo Varejão' }],
      users,
    },
    more: {
      generated_at: new Date().toISOString(),
      ai: { decks: 23, decks_prev: 9, people: 11, cards: 520, all_time: 32, cost_usd: 0.0101, cost_month_usd: 0.0078, at_limit: 3, added: 19, own_ai: 8 },
      ai_daily: daily.map((x, i) => ({ day: x.day, n: i > n / 2 ? i % 3 : 0 })),
      retention: [{ day: 1, eligible: 40, back: 27 }, { day: 7, eligible: 33, back: 15 }, { day: 30, eligible: 14, back: 5 }],
      stickiness: { daily_avg: 6.4, active: 17 },
      groups: { groups: 58, people_with_groups: 12, ungrouped_decks: 9 },
      sharing: { shared_decks: 6, shared_groups: 2, copies: 16 },
      home: [{ what: 'continue', n: 88, people: 14 }, { what: 'create_ai', n: 31, people: 12 }, { what: 'add_sample', n: 17, people: 9 }, { what: 'create_sheet', n: 9, people: 6 }, { what: 'guide_sheets', n: 6, people: 5 }, { what: 'hide_samples', n: 3, people: 3 }],
      hours: Array.from({ length: 24 }, (_, h) => ({ hour: h, n: h < 7 ? 0 : Math.round(12 * Math.exp(-((h - 20) ** 2) / 8) + 6 * Math.exp(-((h - 8) ** 2) / 3)) })),
      due: { cards: 640, people: 13 },
    },
  };
}
