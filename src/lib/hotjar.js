// Hotjar (heatmaps and visit recordings) for the app, my.allecards.app.
// It sets cookies, so under GDPR it only loads after the person agrees.
// The choice is saved on the device, like the website's cookie banner, and can
// be changed any time in Account.

const SITE_ID = 6795258;
const KEY = 'alle-consent';
// Only the real app (and its test copy) send data; local and demo builds don't.
const HOSTS = ['my.allecards.app', 'test.allecards.app'];

export function getConsent() {
  try { return localStorage.getItem(KEY); } catch { return null; } // 'granted' | 'denied' | null
}

let loaded = false;
export function loadHotjar() {
  if (loaded || import.meta.env.VITE_DEMO === 'true' || !HOSTS.includes(window.location.hostname)) return;
  loaded = true;
  /* eslint-disable */
  (function (h, o, t, j, a, r) {
    h.hj = h.hj || function () { (h.hj.q = h.hj.q || []).push(arguments); };
    h._hjSettings = { hjid: SITE_ID, hjsv: 6 };
    a = o.getElementsByTagName('head')[0];
    r = o.createElement('script'); r.async = 1;
    r.src = t + h._hjSettings.hjid + j + h._hjSettings.hjsv;
    a.appendChild(r);
  })(window, document, 'https://static.hotjar.com/c/hotjar-', '.js?sv=');
  /* eslint-enable */
}

export function setConsent(value) {
  try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent('alle-consent', { detail: value }));
  if (value === 'granted') { loadHotjar(); return; }
  // Withdrawn: remove Hotjar's cookies, and reload if it was running so it stops.
  document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n.startsWith('_hj')).forEach((n) => {
    document.cookie = `${n}=; Max-Age=0; path=/`;
    document.cookie = `${n}=; Max-Age=0; path=/; domain=.${window.location.hostname.split('.').slice(-2).join('.')}`;
  });
  if (loaded) window.location.reload();
}

/** Call once at startup: loads Hotjar straight away if the person already agreed. */
export function initHotjar() {
  if (getConsent() === 'granted') loadHotjar();
}
