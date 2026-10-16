import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';
import App from './App.jsx';
import { initTheme } from './lib/theme.js';
import { captureIntent } from './lib/intent.js';
import { UpdateBanner } from './components/UpdateBanner.jsx';
import { Consent } from './components/Consent.jsx';
import { initHotjar } from './lib/hotjar.js';
import { DesignSystem } from './screens/DesignSystem.jsx';
import { Dashboard } from './screens/Dashboard.jsx';
import './styles/design-system.css';
import './styles/onboarding.css';
import './styles/scenes.css';
import './styles/insights.css';

initTheme();
captureIntent(); // ?share= / ?add= links, kept until signed in

function route(path) {
  const p = path.replace(/\/$/, '');
  if (p === '/design') return <DesignSystem />;
  if (p === '/dashboard') return <Dashboard />;
  // Hotjar only on the app itself (not the owner's dashboard or the design system), and only with consent
  initHotjar();
  return <><App /><Consent /></>;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {route(window.location.pathname)}
    <UpdateBanner />
  </React.StrictMode>,
);
