import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isConfigured, isDemo } from '../lib/supabase.js';
import { Logo, Icon } from '../components/Icon.jsx';

/*
 * Owner-only insights at my.allecards.app/dashboard.
 * Two calls: dash_insights() (supabase/009_insights.sql) and dash_more() (013_insights_more.sql:
 * Alle's AI, return rates, Home tab, groups and sharing, study hours). Both return nothing
 * unless the signed-in account is the owner (is_owner()). Without 013 the page still works,
 * and those sections say what to run.
 * Laid out like the app on desktop: a sidebar of sections, centred white cards.
 */

const RANGES = [7, 30, 90];
const SOURCE_LABEL = {
  ready_made: 'Ready-made',
  library: 'Website library',
  sheet: 'Google Sheet',
  ai_or_paste: 'AI or pasted',
  shared: 'Shared copy',
};

const SECTIONS = [
  ['overview', 'Overview', 'home'],
  ['learning', 'Learning', 'history'],
  ['decks', 'Decks', 'decks'],
  ['ai', 'Alle’s AI', 'sparkle'],
  ['home-tab', 'Home tab', 'homeActive'],
  ['people', 'People', 'person'],
  ['website', 'Website', 'article'],
];
const HOME_LABEL = {
  create_ai: 'Create a deck with AI', create_sheet: 'Import from Google Sheets', template: 'Google Sheet template',
  continue: 'Continue learning', add_sample: 'Added a sample deck', hide_samples: 'Hid the sample decks',
  show_samples: 'Showed the sample decks again', all_guides: 'Read all help and guides',
  guide_sheets: 'Guide: Google Sheets', guide_ai: 'Guide: AI', guide_study: 'Guide: studying', guide_home: 'Guide: Home Screen',
};
const usd = (n) => (n == null ? '–' : `$${Number(n) < 0.01 ? Number(n).toFixed(4) : Number(n).toFixed(2)}`);

const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-GB'));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
const dateShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');
const LANG = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
const langName = (code) => { try { return (LANG && code && code !== '?' && LANG.of(code.split('-')[0])) || code; } catch { return code; } };
const minutes = (m) => (m == null ? '–' : m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);

export function Dashboard() {
  const [days, setDays] = useState(30);
  const [state, setState] = useState({ loading: true });

  async function load(d = days) {
    setState((s) => ({ ...s, loading: true }));
    if (isDemo && import.meta.env.VITE_DEMO === 'true') {
      const { demoInsights } = await import('./dashboardDemo.js');
      setState(demoInsights(d)); return;
    }
    if (!isConfigured) { setState({ noauth: true }); return; }
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) { setState({ noauth: true }); return; }
    const [main, more] = await Promise.all([
      supabase.rpc('dash_insights', { days: d }),
      supabase.rpc('dash_more', { days: d }),
    ]);
    if (main.error) setState({ error: /dash_insights/.test(main.error.message) ? 'missing' : main.error.message });
    else if (!main.data) setState({ notOwner: true, email: sess.session.user.email });
    else setState({ data: main.data, more: more.error ? null : more.data, moreMissing: Boolean(more.error) });
  }
  useEffect(() => { document.title = 'Insights | Alle'; load(days); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.noauth) return <Shell><p className="ins-note">Sign in to Alle first, then open this page again.</p></Shell>;
  if (state.notOwner) return <Shell><p className="ins-note">This page is only for the owner. You’re signed in as {state.email}.</p></Shell>;
  if (state.error === 'missing') return <Shell><p className="ins-note">Run <code>supabase/009_insights.sql</code> in Supabase to turn on this dashboard.</p></Shell>;
  if (state.error) return <Shell><p className="ins-note">Couldn’t load: {state.error}</p></Shell>;
  if (!state.data) return <Shell><p className="ins-note">Loading…</p></Shell>;

  const d = state.data;
  const k = d.kpis;
  const m = state.more;
  const needMore = <p className="ins-note">Run <code>supabase/013_insights_more.sql</code> in Supabase to see these numbers.</p>;
  return (
    <Shell
      right={(
        <>
          <button type="button" className="ins-refresh" onClick={() => load(days)} disabled={state.loading}>
            {state.loading ? 'Updating…' : `Updated ${ago(d.generated_at)}`}
          </button>
          <div className="ins-range" role="tablist" aria-label="Period">
            {RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={days === r} className={days === r ? 'is-on' : ''} onClick={() => setDays(r)}>{r} days</button>
            ))}
          </div>
        </>
      )}
    >
      <Section id="overview" title="Overview" text={`The last ${d.days} days, compared with the ${d.days} days before.`}>
        <div className="ins-kpis">
          <Kpi label="People" value={fmt(k.users)} sub={`+${fmt(k.users_new)} new`} now={k.users_new} prev={k.users_new_prev} spark={d.daily.map((x) => x.signups)} />
          <Kpi label="Active" value={fmt(k.active)} sub={`of ${fmt(k.users)} people`} now={k.active} prev={k.active_prev} spark={d.daily.map((x) => x.active)} />
          <Kpi label="Decks created" value={fmt(k.decks_new)} sub={`${fmt(k.decks)} in total`} now={k.decks_new} prev={k.decks_new_prev} spark={d.daily.map((x) => x.decks)} />
          <Kpi label="Cards reviewed" value={fmt(k.reviews)} sub={`${fmt(k.sessions)} sessions`} now={k.reviews} prev={k.reviews_prev} spark={d.daily.map((x) => x.reviews)} />
          <Kpi label="Study time" value={minutes(k.minutes)} sub={k.active ? `${minutes(k.minutes / k.active)} per active person` : 'timed from now on'} now={k.minutes} prev={k.minutes_prev} />
          <Kpi label="AI decks" value={m ? fmt(m.ai.decks) : '–'} sub={m ? `${usd(m.ai.cost_usd)} estimated` : 'needs 013'} now={m?.ai.decks} prev={m?.ai.decks_prev} spark={m?.ai_daily.map((x) => x.n)} />
        </div>
        <div className="ins-grid">
          <Card title="Daily activity" wide><ActivityChart daily={d.daily} /></Card>
          <Card title={`Sign-ups (${fmt(k.users_new)} in ${d.days} days)`} wide><Signups daily={d.daily} users={d.users} days={d.days} /></Card>
        </div>
      </Section>

      <Section id="learning" title="Learning" text="Are people building a habit, and when do they study?">
        <div className="ins-grid">
          <Card title="From sign-up to habit"><Funnel steps={d.funnel} /></Card>
          <Card title="Do people come back?">{m ? <Retention rows={m.retention} stick={m.stickiness} /> : needMore}</Card>
          <Card title="Study sessions">
            <div className="ins-stats">
              <Stat label="Average session" value={k.sessions ? minutes(k.minutes / (k.sessions + k.sessions_left)) : '–'} />
              <Stat label="Answers right" value={k.reviews_scored ? `${pct(k.correct, k.reviews_scored)}%` : '–'} note={k.reviews_scored ? null : 'counted from now on'} />
              <Stat label="Finished" value={`${pct(k.sessions, k.sessions + k.sessions_left)}%`} note={`${fmt(k.sessions_left)} left early`} />
              <Stat label="Cards known well" value={fmt(k.cards_known)} note="in the top boxes" />
              {m && <Stat label="Cards due now" value={fmt(m.due.cards)} note={`for ${fmt(m.due.people)} ${m.due.people === 1 ? 'person' : 'people'}`} />}
            </div>
          </Card>
          <Card title="When people study" wide>{m ? <Hours rows={m.hours} /> : needMore}</Card>
        </div>
      </Section>

      <Section id="decks" title="Decks" text="Where decks come from, and what people learn.">
        <div className="ins-grid">
          <Card title="Where decks come from">
            <Bars rows={d.sources.map((s) => ({ label: SOURCE_LABEL[s.source] || s.source, n: s.decks, note: `${s.people} ${s.people === 1 ? 'person' : 'people'}` }))} />
          </Card>
          <Card title="Ready-made decks added">
            {d.ready_made.length ? <Bars rows={d.ready_made.map((r) => ({ label: r.title, n: r.people, note: 'people' }))} /> : <Empty />}
          </Card>
          <Card title="Languages"><Bars rows={d.languages.map((r) => ({ label: langName(r.lang), n: r.n }))} /></Card>
          <Card title="Groups and sharing" wide>
            {m ? (
              <div className="ins-stats ins-stats--row">
                <Stat label="Groups" value={fmt(m.groups.groups)} note={`${fmt(m.groups.people_with_groups)} people use 2 or more`} />
                <Stat label="Decks in “Your decks”" value={fmt(m.groups.ungrouped_decks)} note="not in a group yet" />
                <Stat label="Shared decks" value={fmt(m.sharing.shared_decks)} />
                <Stat label="Shared groups" value={fmt(m.sharing.shared_groups)} />
                <Stat label="Copies received" value={fmt(m.sharing.copies)} note="decks added from a shared link" />
              </div>
            ) : needMore}
          </Card>
          <Card title="Decks people made" wide><DeckTable rows={d.recent_decks} cols={['title', 'labels', 'cards', 'source', 'who', 'created_at']} /></Card>
          <Card title="Most studied decks" wide><DeckTable rows={d.top_decks} cols={['title', 'reviews', 'cards', 'source', 'who']} /></Card>
        </div>
      </Section>

      <Section id="ai" title="Alle’s AI" text="Decks made in the app with Claude. Test builds’ pretend cards are left out.">
        {m ? (
          <>
            <div className="ins-kpis ins-kpis--4">
              <Kpi label="AI decks" value={fmt(m.ai.decks)} sub={`${fmt(m.ai.all_time)} all time`} now={m.ai.decks} prev={m.ai.decks_prev} spark={m.ai_daily.map((x) => x.n)} />
              <Kpi label="People using AI" value={fmt(m.ai.people)} sub={`of ${fmt(k.active)} active`} />
              <Kpi label="Cards written" value={fmt(m.ai.cards)} sub={m.ai.decks ? `${Math.round(m.ai.cards / m.ai.decks)} per deck` : '–'} />
              <Kpi label="Estimated cost" value={usd(m.ai.cost_usd)} sub={`${usd(m.ai.cost_month_usd)} this month`} />
            </div>
            <div className="ins-grid">
              <Card title="From AI to a deck">
                <div className="ins-stats">
                  <Stat label="Made and added" value={m.ai.decks ? `${pct(m.ai.added, m.ai.decks)}%` : '–'} note={`${fmt(m.ai.added)} of ${fmt(m.ai.decks)} added`} />
                  <Stat label="Used the free 3" value={fmt(m.ai.at_limit)} note="people this month" />
                  <Stat label="With their own AI" value={fmt(m.ai.own_ai)} note="copied the prompt instead" />
                </div>
              </Card>
              <Card title="AI deck subjects">{d.ai_subjects.length ? <Bars rows={d.ai_subjects.map((r) => ({ label: r.subject, n: r.n }))} /> : <Empty />}</Card>
              <Card title="AI decks per day"><MiniBars rows={m.ai_daily.map((x) => ({ day: x.day, n: x.n }))} /></Card>
            </div>
            <p className="ins-note ins-note--small">The cost is an estimate (about $0.0004 for 20 cards). The real figure is at platform.claude.com/usage.</p>
          </>
        ) : needMore}
      </Section>

      <Section id="home-tab" title="Home tab" text="What people tap on Home. Counted from 13 October 2026.">
        <div className="ins-grid">
          <Card title="Taps on Home" wide>
            {m ? (m.home.length ? <Bars rows={m.home.map((r) => ({ label: HOME_LABEL[r.what] || r.what, n: r.n, note: `${r.people} ${r.people === 1 ? 'person' : 'people'}` }))} /> : <Empty />) : needMore}
          </Card>
        </div>
      </Section>

      <Section id="people" title={`People (${fmt(d.users.length)})`} text="Tap a person to see their decks.">
        <div className="ins-grid"><Card wide><People users={d.users} /></Card></div>
      </Section>

      <Section id="website" title="Website" text="Visitors, search terms and rankings live in Google’s tools for now.">
        <div className="ins-grid">
          <Card wide>
            <div className="ins-links">
              <a href="https://analytics.google.com/" target="_blank" rel="noreferrer">Google Analytics</a>
              <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer">Search Console</a>
              <a href="https://platform.claude.com/usage" target="_blank" rel="noreferrer">Claude usage</a>
            </div>
          </Card>
        </div>
      </Section>
    </Shell>
  );
}

/* Desktop: a sidebar of sections (the one in view is highlighted). Phones: the sections as chips. */
function Shell({ right, children }) {
  const [active, setActive] = useState('overview');
  const mainRef = useRef(null);
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(id)).filter(Boolean);
    if (!els.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: '-20% 0px -70% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  });
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="ins-app">
      <aside className="ins-side" aria-label="Sections">
        <a className="ins-side__logo" href="/" aria-label="Open Alle"><Logo /></a>
        <span className="ins-side__label">Insights</span>
        <nav className="ins-side__nav">
          {SECTIONS.map(([id, label, icon]) => (
            <button key={id} type="button" className={`ins-side__item ${active === id ? 'is-active' : ''}`} onClick={() => go(id)}>
              <Icon name={icon} />{label}
            </button>
          ))}
        </nav>
        <a className="ins-side__item ins-side__foot" href="/"><Icon name="back" />Back to Alle</a>
      </aside>
      <main className="ins" ref={mainRef}>
        <header className="ins-head">
          <h1 className="ins-title">Insights</h1>
          <div className="ins-head__right">{right}</div>
        </header>
        <nav className="ins-chips" aria-label="Sections">
          {SECTIONS.map(([id, label]) => <button key={id} type="button" className={active === id ? 'is-on' : ''} onClick={() => go(id)}>{label}</button>)}
        </nav>
        {children}
      </main>
    </div>
  );
}

function Section({ id, title, text, children }) {
  return (
    <section id={id} className="ins-section">
      <div className="ins-section__head">
        <h2 className="ins-section__title">{title}</h2>
        {text && <p className="ins-section__text">{text}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ title, wide, children }) {
  return (
    <div className={`ins-card ${wide ? 'ins-card--wide' : ''}`}>
      {title && <h3 className="ins-card__title">{title}</h3>}
      {children}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="ins-stat">
      <span>{label}</span>
      <b>{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

const Empty = () => <p className="ins-note">Nothing yet.</p>;

function Trend({ now, prev }) {
  if (now == null || prev == null) return null;
  if (!prev) return now ? <span className="ins-trend up">new</span> : null;
  if (prev < 5) return null; // percentages on tiny numbers are just noise
  const change = Math.round(((now - prev) / prev) * 100);
  if (!change) return <span className="ins-trend">±0%</span>;
  return <span className={`ins-trend ${change > 0 ? 'up' : 'down'}`}>{change > 0 ? '↑' : '↓'} {Math.abs(change)}%</span>;
}

function Spark({ values }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 120; const h = 32;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 4) - 2}`).join(' ');
  return (
    <svg className="ins-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Kpi({ label, value, sub, now, prev, spark }) {
  return (
    <div className="ins-kpi">
      <div className="ins-kpi__top"><span>{label}</span><Trend now={now} prev={prev} /></div>
      <div className="ins-kpi__value">{value}</div>
      <div className="ins-kpi__sub">{sub}</div>
      <Spark values={spark} />
    </div>
  );
}

function ActivityChart({ daily }) {
  const [hover, setHover] = useState(null);
  const maxR = Math.max(1, ...daily.map((x) => x.reviews));
  const maxA = Math.max(1, ...daily.map((x) => x.active));
  const W = 900; const H = 220; const pad = 28;
  const bw = (W - pad * 2) / daily.length;
  const y = (v, m) => H - pad - (v / m) * (H - pad * 2);
  const line = daily.map((x, i) => `${pad + i * bw + bw / 2},${y(x.active, maxA)}`).join(' ');
  const every = Math.ceil(daily.length / 8);
  const h = hover != null ? daily[hover] : null;
  return (
    <div className="ins-chart">
      <div className="ins-legend">
        <span><i className="sw sw--bar" /> Cards reviewed</span>
        <span><i className="sw sw--line" /> Active people</span>
        {h && <span className="ins-legend__hover">{dateShort(h.day)}: {h.reviews} reviews · {h.active} active · {h.signups} sign-ups · {h.decks} decks</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ins-chart__svg" onMouseLeave={() => setHover(null)}>
        {daily.map((x, i) => (
          <g key={x.day} onMouseEnter={() => setHover(i)}>
            <rect x={pad + i * bw} y={pad} width={bw} height={H - pad * 2} fill="transparent" />
            <rect x={pad + i * bw + bw * 0.18} y={y(x.reviews, maxR)} width={bw * 0.64} height={Math.max(0, H - pad - y(x.reviews, maxR))} rx="3" className={`bar ${hover === i ? 'is-hover' : ''}`} />
            {x.signups > 0 && <circle cx={pad + i * bw + bw / 2} cy={H - pad + 10} r="3.5" className="signup" />}
            {i % every === 0 && <text x={pad + i * bw + bw / 2} y={H - 2} textAnchor="middle" className="axis">{dateShort(x.day)}</text>}
          </g>
        ))}
        <polyline points={line} className="line" />
      </svg>
      <p className="ins-note ins-note--small">Dots under the axis mark days with new sign-ups.</p>
    </div>
  );
}

function Signups({ daily, users, days }) {
  const max = Math.max(1, ...daily.map((x) => x.signups));
  const W = 900; const H = 150; const pad = 22;
  const bw = (W - pad * 2) / daily.length;
  const every = Math.ceil(daily.length / 8);
  const since = Date.now() - days * 86400000;
  const recent = users.filter((u) => new Date(u.joined).getTime() >= since)
    .sort((a, b) => new Date(b.joined) - new Date(a.joined));
  return (
    <div className="ins-signups">
      <svg viewBox={`0 0 ${W} ${H}`} className="ins-chart__svg" role="img" aria-label="Sign-ups per day">
        {daily.map((x, i) => {
          const h = (x.signups / max) * (H - pad * 2 - 14);
          const cx = pad + i * bw + bw / 2;
          return (
            <g key={x.day}>
              <title>{`${dateShort(x.day)}: ${x.signups} sign-up${x.signups === 1 ? '' : 's'}`}</title>
              {x.signups > 0 && <rect x={pad + i * bw + bw * 0.18} y={H - pad - h} width={bw * 0.64} height={h} rx="3" className="bar-signup" />}
              {x.signups > 0 && <text x={cx} y={H - pad - h - 5} textAnchor="middle" className="val">{x.signups}</text>}
              {i % every === 0 && <text x={cx} y={H - 4} textAnchor="middle" className="axis">{dateShort(x.day)}</text>}
            </g>
          );
        })}
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="base" />
      </svg>
      {recent.length ? (
        <div className="ins-table-wrap">
          <table className="ins-table">
            <thead><tr><th>Person</th><th>Signed up</th><th>Added a deck</th><th>Studied</th><th>Last active</th></tr></thead>
            <tbody>
              {recent.map((u) => (
                <tr key={u.email}>
                  <td><b>{u.name || '—'}</b><small className="ins-sub">{u.email}</small></td>
                  <td>{new Date(u.joined).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{u.decks ? `Yes, ${u.decks}` : <span className="ins-no">Not yet</span>}</td>
                  <td>{u.reviews ? `${fmt(u.reviews)} reviews` : <span className="ins-no">Not yet</span>}</td>
                  <td>{ago(u.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="ins-note">No sign-ups in this period.</p>}
    </div>
  );
}

function Funnel({ steps }) {
  const top = steps[0]?.n || 0;
  return (
    <div className="ins-funnel">
      {steps.map((s) => (
        <div key={s.step} className="ins-funnel__row">
          <div className="ins-funnel__label"><span>{s.step}</span><b>{fmt(s.n)} <em>{pct(s.n, top)}%</em></b></div>
          <div className="ins-bar"><i style={{ width: `${Math.max(2, pct(s.n, top))}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="ins-bars">
      {rows.slice(0, 10).map((r) => (
        <div key={r.label} className="ins-bars__row">
          <div className="ins-funnel__label"><span>{r.label}</span><b>{fmt(r.n)}{r.note ? <em> {r.note}</em> : null}</b></div>
          <div className="ins-bar"><i style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

const COL = {
  title: ['Deck', (r) => <b>{r.title}</b>],
  labels: ['Sides', (r) => r.labels || '–'],
  cards: ['Cards', (r) => fmt(r.cards)],
  reviews: ['Reviews', (r) => fmt(r.reviews)],
  source: ['From', (r) => SOURCE_LABEL[r.source] || r.source],
  who: ['By', (r) => r.who],
  created_at: ['Created', (r) => ago(r.created_at)],
};

function DeckTable({ rows, cols }) {
  if (!rows.length) return <Empty />;
  return (
    <div className="ins-table-wrap">
      <table className="ins-table">
        <thead><tr>{cols.map((c) => <th key={c}>{COL[c][0]}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{COL[c][1](r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const PEOPLE_COLS = [
  ['name', 'Person'], ['joined', 'Joined'], ['last_active', 'Last active'], ['active_days', 'Active days'],
  ['decks', 'Decks'], ['reviews', 'Reviews'], ['minutes', 'Study time'],
];

function People({ users }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(['last_active', -1]);
  const [open, setOpen] = useState(null);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = users.filter((u) => !needle || `${u.name} ${u.email}`.toLowerCase().includes(needle));
    const [key, dir] = sort;
    const val = (u) => (key === 'name' ? (u.name || u.email).toLowerCase()
      : ['joined', 'last_active'].includes(key) ? new Date(u[key] || 0).getTime() : Number(u[key] || 0));
    return [...list].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0));
  }, [users, q, sort]);
  const by = (key) => setSort(([k, d]) => [key, k === key ? -d : -1]);
  return (
    <>
      <input className="ins-search" type="search" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="ins-table-wrap">
        <table className="ins-table ins-table--people">
          <thead>
            <tr>{PEOPLE_COLS.map(([key, label]) => (
              <th key={key}><button type="button" onClick={() => by(key)} className={sort[0] === key ? 'is-sorted' : ''}>
                {label}{sort[0] === key ? (sort[1] < 0 ? ' ↓' : ' ↑') : ''}
              </button></th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <PersonRow key={u.email} u={u} open={open === u.email} onToggle={() => setOpen(open === u.email ? null : u.email)} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PersonRow({ u, open, onToggle }) {
  return (
    <>
      <tr className={`ins-person ${open ? 'is-open' : ''}`} onClick={onToggle}>
        <td><b>{u.name || '—'}</b><small>{u.email}</small></td>
        <td>{dateShort(u.joined)}</td>
        <td>{ago(u.last_active)}</td>
        <td>{fmt(u.active_days)}</td>
        <td>{fmt(u.decks)}</td>
        <td>{fmt(u.reviews)}</td>
        <td>{minutes(u.minutes)}</td>
      </tr>
      {open && (
        <tr className="ins-person__decks">
          <td colSpan={7}>
            {u.deck_list.length ? (
              <ul>
                {u.deck_list.map((dk, i) => (
                  <li key={i}>
                    <b>{dk.title}</b>
                    <span>{dk.labels || ''}</span>
                    <span>{fmt(dk.cards)} cards</span>
                    <span>{SOURCE_LABEL[dk.source] || dk.source}</span>
                    {dk.shared && <span className="ins-pill">shared</span>}
                    <span>{dateShort(dk.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : <span className="ins-note">No decks yet. Last sign-in {ago(u.last_sign_in)}.</span>}
          </td>
        </tr>
      )}
    </>
  );
}

/** Of everyone who signed up at least N days ago, how many were active on day N or later. */
function Retention({ rows, stick }) {
  return (
    <div className="ins-funnel">
      {rows.map((r) => (
        <div key={r.day} className="ins-funnel__row">
          <div className="ins-funnel__label">
            <span>Back after {r.day === 1 ? '1 day' : `${r.day} days`}</span>
            <b>{r.eligible ? `${pct(r.back, r.eligible)}%` : '–'} <em>{fmt(r.back)} of {fmt(r.eligible)}</em></b>
          </div>
          <div className="ins-bar ins-bar--blue"><i style={{ width: `${Math.max(2, pct(r.back, r.eligible))}%` }} /></div>
        </div>
      ))}
      {stick?.active ? <p className="ins-note ins-note--small">On an average day, {stick.daily_avg} of the {fmt(stick.active)} active people use Alle.</p> : null}
    </div>
  );
}

/** Finished sessions by hour of the day (Brussels time). */
function Hours({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((t, r) => t + r.n, 0);
  if (!total) return <Empty />;
  const peak = rows.reduce((a, b) => (b.n > a.n ? b : a), rows[0]);
  return (
    <div>
      <div className="ins-hours" role="img" aria-label="Finished sessions by hour of the day">
        {rows.map((r) => (
          <div key={r.hour} className="ins-hours__col" title={`${String(r.hour).padStart(2, '0')}:00, ${r.n} sessions`}>
            <i style={{ height: `${Math.max(r.n ? 6 : 2, (r.n / max) * 100)}%` }} className={r.n === max ? 'is-peak' : ''} />
            {r.hour % 3 === 0 && <span>{String(r.hour).padStart(2, '0')}</span>}
          </div>
        ))}
      </div>
      <p className="ins-note ins-note--small">Busiest around {String(peak.hour).padStart(2, '0')}:00 (Brussels time).</p>
    </div>
  );
}

function MiniBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.some((r) => r.n)) return <Empty />;
  return (
    <div className="ins-hours ins-hours--days" role="img" aria-label="AI decks per day">
      {rows.map((r) => (
        <div key={r.day} className="ins-hours__col" title={`${dateShort(r.day)}: ${r.n}`}>
          <i style={{ height: `${Math.max(r.n ? 6 : 2, (r.n / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}
