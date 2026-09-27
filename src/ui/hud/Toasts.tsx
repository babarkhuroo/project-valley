import { focus } from '../actions';
import { Icon } from '../common/Icon';
import { ui, useUI, type Toast } from '../store';

function ToastView({ t }: { t: Toast }) {
  return (
    <button
      className={`toast toast-${t.kind}`}
      onClick={() => {
        if (t.target) {
          ui.select(t.target);
          focus(t.target);
        }
        ui.dismissToast(t.id);
      }}
    >
      {t.icon ? <Icon name={t.icon} size={28} /> : null}
      <span>
        <strong>{t.title}</strong>
        {t.body ? <small>{t.body}</small> : null}
      </span>
    </button>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}

export function NotificationsPanel() {
  const history = useUI((s) => s.history);
  const open = useUI((s) => s.panel === 'notifications');
  if (!open) return null;
  return (
    <div className="notif-panel panel pop-in">
      <header>
        <h3>Village news</h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      {history.length === 0 ? <p className="muted">Nothing to report yet — all is peaceful.</p> : null}
      <ul>
        {history.map((t) => (
          <li key={t.id}>
            <ToastView t={t} />
            <time>{new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}
