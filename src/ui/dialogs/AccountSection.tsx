import { useState } from 'react';
import { saveNow } from '../../game/autosave';
import { game } from '../../game/runtime';
import { currentAccount, login, logout, register, sessionToken } from '../../game/session';
import { renameMe } from '../actions';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';

type Mode = 'idle' | 'register' | 'login';

/** Your name, and an account to carry the village to other devices. */
export function AccountSection() {
  const state = useGameState();
  const account = currentAccount();
  const online = sessionToken() !== null;
  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState(state.player.name);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    // Whatever happens next, the village on screen is saved first.
    await saveNow(game());
    const err = mode === 'register' ? await register(username, password, state.player.name) : await login(username, password);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (mode === 'login') window.location.reload();
    else {
      setMode('idle');
      setPassword('');
    }
  };

  return (
    <section>
      <h4>
        <Icon name="villager" size={18} /> You
      </h4>
      <form
        className="rename"
        onSubmit={(e) => {
          e.preventDefault();
          renameMe(name);
        }}
      >
        <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <button className="btn small" type="submit">
          Save name
        </button>
      </form>
      {account ? (
        <div className="account-row">
          <span className="small">
            Signed in as <strong>{account.username}</strong> — this village follows you to any device.
          </span>
          <button
            className="btn small ghost"
            onClick={async () => {
              await saveNow(game());
              await logout();
              window.location.reload();
            }}
          >
            Sign out
          </button>
        </div>
      ) : mode === 'idle' ? (
        <>
          <p className="small muted">{online ? 'Playing as a guest on this device.' : 'Playing offline from this device’s cache.'}</p>
          <div className="row-buttons">
            <button className="btn small green" disabled={!online} onClick={() => setMode('register')}>
              Create an account
            </button>
            <button className="btn small ghost" disabled={!online} onClick={() => setMode('login')}>
              Sign in…
            </button>
          </div>
        </>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="small muted">
            {mode === 'register'
              ? 'Keep this village: pick a username and password, then sign in with them on any device.'
              : 'Sign in to play your account’s village here. This device’s guest village stays where it is only if it has its own account.'}
          </p>
          <input value={username} autoComplete="username" placeholder="Username" onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
          <input type="password" value={password} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder="Password" onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
          {error ? <p className="small warn-text">{error}</p> : null}
          <div className="row-buttons">
            <button className="btn small green" type="submit" disabled={busy || !username || !password}>
              {mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
            <button className="btn small ghost" type="button" onClick={() => setMode('idle')}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
