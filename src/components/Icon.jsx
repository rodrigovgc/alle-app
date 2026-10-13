import { ICONS, LOGO, SHAPES } from '../assets/svg.js';

export function Icon({ name, size, className = '', label }) {
  const icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg
      className={`icon ${className}`}
      viewBox={icon.viewBox}
      style={size ? { width: size, height: size } : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {icon.fills
        ? icon.fills.map((d, i) => <path key={i} d={d} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />)
        : icon.stroke
          ? <path d={icon.d} fill="none" stroke="currentColor" strokeWidth={icon.sw || 1.4} strokeLinecap="round" strokeLinejoin="round" />
          : <path d={icon.d} fill="currentColor" />}
    </svg>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox={LOGO.viewBox} role="img" aria-label="Alle">
      {LOGO.paths.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
    </svg>
  );
}

export function DeckShape({ shape }) {
  const s = SHAPES[shape] || SHAPES.lime;
  return (
    <svg className="deck-shape" viewBox={s.viewBox} aria-hidden="true">
      {s.paths.map((d, i) => <path key={i} d={d} fill="currentColor" />)}
    </svg>
  );
}
