import { useState } from 'react';
import { feedbackContext, sendFeedback } from '../../game/playtest';
import { game, runtime } from '../../game/runtime';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';

const MOODS: { id: 'happy' | 'okay' | 'stuck'; label: string }[] = [
  { id: 'happy', label: 'Enjoying it' },
  { id: 'okay', label: 'It’s okay' },
  { id: 'stuck', label: 'Stuck or confused' },
];

/** "Send feedback": a note and a mood, sent with where the player is in the game. */
export function FeedbackPanel() {
  const open = useUI((s) => s.panel === 'feedback');
  const scene = useUI((s) => s.scene);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<'happy' | 'okay' | 'stuck' | null>(null);
  const [sending, setSending] = useState(false);
  if (!open) return null;
  const send = async () => {
    setSending(true);
    const error = await sendFeedback(text, mood, feedbackContext(game().state, scene));
    setSending(false);
    if (error) {
      ui.toast({ kind: 'warning', title: 'Feedback not sent', body: error, icon: 'info' }, 4000);
      return;
    }
    ui.toast({ kind: 'success', title: 'Thank you!', body: 'Your note is on its way to the developer.', icon: 'feedback' }, 3500);
    runtime.audio.play('notify');
    setText('');
    setMood(null);
    ui.closePanel();
  };
  return (
    <div className="settings panel pop-in feedback-panel" role="dialog" aria-label="Send feedback">
      <header>
        <h3>
          <Icon name="feedback" size={22} /> Send feedback
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="small muted">You’re playtesting! Anything helps — what’s fun, what’s confusing, what broke. Your level and progress are attached so the note makes sense.</p>
      <div className="mood-row">
        {MOODS.map((m) => (
          <button key={m.id} className={`btn small ${mood === m.id ? '' : 'ghost'}`} onClick={() => setMood(mood === m.id ? null : m.id)} aria-pressed={mood === m.id}>
            {m.label}
          </button>
        ))}
      </div>
      <textarea className="feedback-text" rows={5} maxLength={2000} placeholder="What happened? What did you expect?" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row-buttons">
        <button className="btn" disabled={sending || (!text.trim() && !mood)} onClick={() => void send()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/** Asked once: may the game record progress for the playtest? Changeable in Settings. */
export function ProgressConsent() {
  const share = useUI((s) => s.prefs.shareProgress);
  const mode = useUI((s) => s.mode.kind);
  const t = useGameState().tutorial;
  // Not on top of the welcome: once the player has their first villagers working.
  const settled = t.done || t.skipped || t.step >= 2;
  if (share !== 'ask' || mode !== 'normal' || !settled) return null;
  return (
    <div className="intro-card panel pop-in" role="status">
      <div className="intro-head">
        <Icon name="feedback" size={34} />
        <strong>You’re playtesting!</strong>
      </div>
      <p>May the game record your progress — levels, buildings, research and time played — to help balance it? Nothing personal is sent. You can change this in Settings.</p>
      <div className="row-buttons">
        <button className="btn small green" onClick={() => ui.setPrefs({ shareProgress: 'yes' })}>
          Yes, share progress
        </button>
        <button className="btn small ghost" onClick={() => ui.setPrefs({ shareProgress: 'no' })}>
          No thanks
        </button>
      </div>
    </div>
  );
}
