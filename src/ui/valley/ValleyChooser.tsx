import { useEffect, useState } from 'react';
import { IDENTITY } from '../../config/identity';
import { runtime } from '../../game/runtime';
import type { ValleyListing } from '../../game/valleyClient';
import { travelToValley } from '../actions';
import { Icon } from '../common/Icon';
import { ui, useUI } from '../store';

type Tab = 'found' | 'code' | 'browse';

/** First visit (or after leaving): found a Valley, join friends by code, or join an open one. */
export function ValleyChooser() {
  const open = useUI((s) => s.valleyChooser);
  const [tab, setTab] = useState<Tab>('found');
  const [name, setName] = useState<string>(IDENTITY.valleyName);
  const [listed, setListed] = useState(true);
  const [code, setCode] = useState('');
  const [list, setList] = useState<ValleyListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || tab !== 'browse') return;
    setList(null);
    void runtime.valley?.listOpen().then((l) => setList(l ?? []));
  }, [open, tab]);

  if (!open) return null;
  const client = runtime.valley;
  const go = async (attempt: () => Promise<string | null> | undefined) => {
    setBusy(true);
    setError(null);
    const err = (await attempt()) ?? null;
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    ui.set({ valleyChooser: false });
    travelToValley();
  };

  return (
    <div className="modal-backdrop fade-in">
      <div className="modal chooser panel pop-in" role="dialog" aria-label="Find your Valley">
        <header className="chooser-head">
          <Icon name="valley" size={40} />
          <div>
            <h2>Over the ridge</h2>
            <p className="muted">Villages share a Valley: they restore it together, trade, train and celebrate. Up to ten players, with friendly neighbours filling the gaps.</p>
          </div>
        </header>
        <div className="seg chooser-tabs">
          <button className={tab === 'found' ? 'active' : ''} onClick={() => setTab('found')}>
            Found a Valley
          </button>
          <button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}>
            Join friends
          </button>
          <button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}>
            Browse open Valleys
          </button>
        </div>
        {tab === 'found' ? (
          <form
            className="chooser-body"
            onSubmit={(e) => {
              e.preventDefault();
              void go(() => client?.found(name, listed));
            }}
          >
            <label>
              Valley name
              <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} /> Open to anyone (otherwise invite code only)
            </label>
            <p className="small muted">Seven neighbouring villages already live there and will make room as players join. You’ll get an invite code to share.</p>
            <button className="btn green" type="submit" disabled={busy || !name.trim()}>
              <Icon name="valley" size={20} /> Found {name.trim() || 'the Valley'}
            </button>
          </form>
        ) : tab === 'code' ? (
          <form
            className="chooser-body"
            onSubmit={(e) => {
              e.preventDefault();
              void go(() => client?.joinByCode(code));
            }}
          >
            <label>
              Invite code
              <input className="code-input" value={code} maxLength={6} placeholder="ABC123" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <button className="btn green" type="submit" disabled={busy || code.trim().length !== 6}>
              Join
            </button>
          </form>
        ) : (
          <div className="chooser-body">
            {list === null ? <p className="muted">Looking over the ridge…</p> : null}
            {list?.length === 0 ? <p className="muted">No open Valleys with room right now — found your own!</p> : null}
            <ul className="valley-list">
              {list?.map((l) => (
                <li key={l.id}>
                  <span>
                    <strong>{l.name}</strong>
                    <small>
                      {l.players} player{l.players === 1 ? '' : 's'} · {l.neighbours} neighbours · {l.levels} levels restored
                    </small>
                  </span>
                  <button className="btn small green" disabled={busy} onClick={() => void go(() => client?.joinOpen(l.id))}>
                    Join
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error ? <p className="warn-text">{error}</p> : null}
        <div className="row-buttons end">
          <button className="btn ghost" onClick={() => ui.set({ valleyChooser: false })}>
            Not yet
          </button>
        </div>
      </div>
    </div>
  );
}
