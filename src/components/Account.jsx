import { useState } from 'react';
import { Button } from './Button.jsx';
import { Field, SheetActions } from './Sheet.jsx';
import { Segmented } from './Segmented.jsx';
import * as api from '../lib/api.js';
import { supabase } from '../lib/supabase.js';
import { getThemePref, setThemePref } from '../lib/theme.js';
import { announceSaved } from '../lib/saved.js';
import { getConsent, setConsent } from '../lib/hotjar.js';

/*
 * Theme: appearance (light / dark / automatic) and deck colours. Both save on
 * their own, so each change shows "Changes saved".
 */
export function ThemeSettings({ colorMode, onColorMode }) {
  const [theme, setTheme] = useState(getThemePref);
  const changeTheme = (t) => { setThemePref(t); setTheme(t); announceSaved(); };
  return (
    <div className="sheet__body account">
      <section className="account__group">
        <h3 className="account__label" id="acc-theme">Appearance</h3>
        <Segmented
          labelledBy="acc-theme"
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'Automatic' }]}
          value={theme}
          onChange={changeTheme}
        />
      </section>
      <section className="account__group">
        <h3 className="account__label" id="acc-color">Deck colours</h3>
        <Segmented
          labelledBy="acc-color"
          options={[{ value: 'colorful', label: 'Colorful' }, { value: 'monochrome', label: 'Monochrome' }]}
          value={colorMode}
          onChange={onColorMode}
        />
      </section>
    </div>
  );
}

/*
 * Account: name, email, password, sign out and a clearly separated delete
 * option. Shown in a sheet from the avatar menu.
 */
/** Hotjar on or off. Same choice as the cookie question; turning it off reloads so it stops. */
function UsageStats() {
  const [value, setValue] = useState(() => (getConsent() === 'granted' ? 'granted' : 'denied'));
  return (
    <section className="account__group">
      <h3 className="account__label" id="acc-stats">Help improve Alle</h3>
      <p className="sheet__text">Let Alle use Hotjar to see how people move around the app. It uses cookies. <a href="https://allecards.app/privacy#cookies" target="_blank" rel="noreferrer">Learn more</a></p>
      <Segmented
        labelledBy="acc-stats"
        options={[{ value: 'granted', label: 'Allow' }, { value: 'denied', label: 'Don’t allow' }]}
        value={value}
        onChange={(v) => { setValue(v); setConsent(v); announceSaved(); }}
      />
    </section>
  );
}

export function Account({ user, onUserUpdated, onSignOut }) {
  const email = user.email;
  const meta = user.user_metadata || {};
  const [first, setFirst] = useState(meta.first_name || '');
  const [last, setLast] = useState(meta.last_name || '');
  const [nameState, setNameState] = useState(null);
  const nameChanged = first.trim() !== (meta.first_name || '') || last.trim() !== (meta.last_name || '');
  async function saveName(e) {
    e.preventDefault();
    setNameState('saving');
    const { data, error } = await supabase.auth.updateUser({ data: { first_name: first.trim(), last_name: last.trim() } });
    if (error) { setNameState(error.message); return; }
    setNameState('done');
    if (data?.user) onUserUpdated?.(data.user);
  }
  const [emailValue, setEmailValue] = useState(email);
  const [emailState, setEmailState] = useState(null);
  async function saveEmail(e) {
    e.preventDefault();
    if (!emailValue || emailValue === email) return;
    setEmailState('saving');
    try { await api.changeEmail(emailValue); setEmailState('done'); }
    catch (err) { setEmailState(err.message); }
  }

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwState, setPwState] = useState(null); // null | 'saving' | 'done' | error string
  async function savePassword(e) {
    e.preventDefault();
    if (pw.length < 8 || pw !== pw2) return;
    setPwState('saving');
    try { await api.changePassword(pw); setPw(''); setPw2(''); setPwState('done'); }
    catch (err) { setPwState(err.message); }
  }

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  return (
    <div className="sheet__body account">
      <form className="account__group" onSubmit={saveName}>
        <h3 className="account__label">Name</h3>
        <div className="name-row">
          <Field label="First name">
            <input className="input" autoComplete="given-name" value={first} onChange={(e) => { setFirst(e.target.value); setNameState(null); }} />
          </Field>
          <Field label="Last name">
            <input className="input" autoComplete="family-name" value={last} onChange={(e) => { setLast(e.target.value); setNameState(null); }} />
          </Field>
        </div>
        {typeof nameState === 'string' && !['saving', 'done'].includes(nameState) && <p className="form-error" role="alert">{nameState}</p>}
        {nameState === 'done' && <p className="form-notice" role="status">Name saved.</p>}
        <Button type="submit" variant="secondary" disabled={!nameChanged || nameState === 'saving'}>
          {nameState === 'saving' ? 'Saving…' : 'Save name'}
        </Button>
      </form>
      <form className="account__group" onSubmit={saveEmail}>
        <h3 className="account__label">Email</h3>
        <Field label="Email address" hint="We’ll send a confirmation link to the new address.">
          <input className="input" type="email" autoComplete="email" value={emailValue}
            onChange={(e) => { setEmailValue(e.target.value); setEmailState(null); }} />
        </Field>
        {typeof emailState === 'string' && emailState !== 'saving' && emailState !== 'done' && (
          <p className="form-error" role="alert">{emailState}</p>
        )}
        {emailState === 'done' && <p className="form-notice" role="status">Check your new inbox to confirm the change.</p>}
        <Button type="submit" variant="secondary" disabled={!emailValue || emailValue === email || emailState === 'saving'}>
          {emailState === 'saving' ? 'Saving…' : 'Update email'}
        </Button>
      </form>

      <form className="account__group" onSubmit={savePassword}>
        <h3 className="account__label">Change password</h3>
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={pw}
            onChange={(e) => { setPw(e.target.value); setPwState(null); }} />
        </Field>
        <Field label="Repeat new password">
          <input className="input" type="password" autoComplete="new-password" value={pw2}
            onChange={(e) => { setPw2(e.target.value); setPwState(null); }} />
        </Field>
        {pw2 && pw !== pw2 && <p className="form-error">Those passwords don’t match.</p>}
        {typeof pwState === 'string' && pwState !== 'saving' && pwState !== 'done' && (
          <p className="form-error" role="alert">{pwState}</p>
        )}
        {pwState === 'done' && <p className="form-notice" role="status">Password updated.</p>}
        <Button type="submit" variant="secondary" disabled={pw.length < 8 || pw !== pw2 || pwState === 'saving'}>
          {pwState === 'saving' ? 'Saving…' : 'Update password'}
        </Button>
      </form>

      <UsageStats />

      <SheetActions>
        <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
        {!confirmDelete ? (
          <button type="button" className="text-btn account__delete" onClick={() => setConfirmDelete(true)}>
            Delete account
          </button>
        ) : (
          <div className="account__confirm">
            <p className="sheet__text">This deletes your account, decks and progress for good. You can sign up again with the same email later.</p>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <Button variant="danger" disabled={deleting} onClick={async () => {
              setDeleting(true); setDeleteError('');
              try { await api.deleteAccount(); } catch (err) { setDeleteError(err.message); setDeleting(false); }
            }}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
            <button type="button" className="text-btn" onClick={() => setConfirmDelete(false)}>Keep my account</button>
          </div>
        )}
      </SheetActions>
    </div>
  );
}
