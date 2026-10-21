// Tab icon in the colour of the deck being studied (like Google Calendar's
// daily date). Lime, or no deck, keeps the normal icon from index.html.

// Fixed light-theme tones: the tab bar isn't themed like the page, so the dark
// theme's deck colours would look muddy there.
const TAB_COLORS = {
  purple: '#B4ADFF', pink: '#FA99C5', blue: '#92C6FB', green: '#A4ED8B',
  yellow: '#F6D93F', red: '#FC9C9C', beige: '#E8E5DA',
};

const BAR = 'M0 11.2421C0 10.4709 0.471837 9.77825 1.18949 9.49592L6.8189 7.28121C8.05003 6.79686 9.38235 7.70443 9.38235 9.02741V33.8871C9.38235 35.2101 8.05003 36.1177 6.8189 35.6333L1.18949 33.4186C0.471836 33.1363 0 32.4436 0 31.6724V11.2421Z';

export function faviconSvg(bg) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><path transform="translate(9 2.3339) scale(0.63950)" d="${BAR}" fill="#0C0C0C"/><path transform="translate(17 2.3339) scale(0.63950)" d="${BAR}" fill="#0C0C0C"/></svg>`;
}

/** The tab colour for a deck colour, or null to keep the normal lime icon. */
export const tabColor = (color) => TAB_COLORS[color] || null;

let saved = null; // the original <link rel="icon"> tags while ours is shown

/** Show the deck's colour in the tab; pass null to put the normal icon back. */
export function setDeckFavicon(color) {
  if (typeof document === 'undefined') return;
  const bg = tabColor(color);
  document.querySelectorAll('link[data-deck-icon]').forEach((l) => l.remove());
  if (!bg) {
    if (saved) { saved.forEach((l) => document.head.appendChild(l)); saved = null; }
    return;
  }
  if (!saved) {
    saved = [...document.querySelectorAll('link[rel="icon"]')];
    saved.forEach((l) => l.remove());
  }
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.dataset.deckIcon = '';
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(bg))}`;
  document.head.appendChild(link);
}
