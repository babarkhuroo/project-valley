import { useEffect, useRef, useState } from 'react';
import { CHAT_BALANCE } from '../../config/valley';
import { playerId } from '../../game/persistence';
import { runtime } from '../../game/runtime';
import { Icon } from '../common/Icon';
import { useGameState, useOnline, useValley } from '../hooks';
import { ui, useUI } from '../store';
import { agoText, memberName } from './format';

/** Top-bar button for the Valley chat, with an unread count. */
export function ChatButton() {
  const state = useGameState();
  const { snapshot } = useValley();
  const seen = useUI((s) => s.chatSeen);
  if (!state.valley.valleyId || !snapshot) return null;
  const me = playerId();
  const unread = (snapshot.chat ?? []).filter((m) => m.id > seen && m.member !== me).length;
  return (
    <button className="round-btn" onClick={() => ui.openPanel('chat')} title="Valley chat">
      <Icon name="chat" size={24} />
      {unread > 0 ? <span className="badge-count">{unread > 9 ? '9+' : unread}</span> : null}
    </button>
  );
}

/** The Valley's chat: everyone in it, neighbours included, in one friendly thread. */
export function ChatPanel() {
  const open = useUI((s) => s.panel === 'chat');
  const { snapshot, fetchedAt, receivedAt } = useValley();
  const online = useOnline();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const messages = snapshot?.chat ?? [];
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : 0;
  useEffect(() => {
    if (!open) return;
    ui.set({ chatSeen: lastId });
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [open, lastId]);
  if (!open || !snapshot) return null;
  const me = playerId();
  const serverNow = fetchedAt + (Date.now() - receivedAt);
  const players = snapshot.members.filter((m) => m.kind === 'player' && m.leftAt === null);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    const err = (await runtime.valley?.sendChat(t)) ?? 'The Valley is out of reach right now';
    if (err) setError(err);
    else setText('');
  };
  return (
    <div className="side-panel chat-panel panel pop-in">
      <header>
        <h3>
          <Icon name="chat" size={22} /> {snapshot.name}
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="small muted">
        {players.filter((p) => online.has(p.id)).length} of {players.length} players here now · neighbours chat too
      </p>
      <ol className="chat" ref={list}>
        {messages.length === 0 ? <li className="muted small">No messages yet. Say hello!</li> : null}
        {messages.map((m) => {
          const author = snapshot.members.find((x) => x.id === m.member);
          return (
            <li key={m.id} className={m.member === me ? 'mine' : author?.kind === 'simulated' ? 'neighbour' : ''}>
              <span className="chat-meta">
                <strong>{memberName(snapshot, m.member, me)}</strong>
                <time>{agoText(serverNow - m.at)}</time>
              </span>
              <span className="chat-text">{m.text}</span>
            </li>
          );
        })}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input value={text} maxLength={CHAT_BALANCE.maxLength} placeholder="Say something kind…" onChange={(e) => setText(e.target.value)} aria-label="Message" />
        <button className="btn small green" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
      {error ? <p className="small warn-text">{error}</p> : null}
    </div>
  );
}
