import type { ReactNode } from 'react';
import type { ResourceBundle } from '../../config/buildings';
import { RESOURCES, RESOURCE_ORDER } from '../../config/resources';
import type { GameState } from '../../sim/types';
import { Icon } from './Icon';

export function Bar({ value, tone = 'green', label, thin }: { value: number; tone?: 'green' | 'honey' | 'blue' | 'red' | 'clay'; label?: ReactNode; thin?: boolean }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`bar tone-${tone} ${thin ? 'thin' : ''}`}>
      <i style={{ width: `${pct}%` }} />
      {label !== undefined ? <span>{label}</span> : null}
    </div>
  );
}

/** Resource cost chips; red when the player is short. */
export function Cost({ bundle, state, compact }: { bundle: ResourceBundle; state: GameState; compact?: boolean }) {
  const entries = RESOURCE_ORDER.filter((r) => (bundle[r] ?? 0) > 0);
  if (entries.length === 0) return <span className="cost free">Free</span>;
  return (
    <span className={`cost ${compact ? 'compact' : ''}`}>
      {entries.map((r) => {
        const need = bundle[r] ?? 0;
        const short = state.resources[r] < need;
        return (
          <span key={r} className={`cost-chip ${short ? 'short' : ''}`} title={`${need} ${RESOURCES[r].name}${short ? ` (you have ${Math.floor(state.resources[r])})` : ''}`}>
            <Icon name={r} size={18} />
            {need}
          </span>
        );
      })}
    </span>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="psection">
      <header>
        <h4>{title}</h4>
        {aside}
      </header>
      {children}
    </section>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'idle' | 'warn' | 'good' | 'blue' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
