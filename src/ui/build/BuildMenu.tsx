import { useEffect, useRef, useState } from 'react';
import { BUILDINGS, BUILDING_CATEGORY_LABEL, BUILD_MENU_ORDER, type BuildingCategory, type BuildingId } from '../../config/buildings';
import { RESEARCH } from '../../config/research';
import { RESOURCES } from '../../config/resources';
import { canAfford } from '../../sim/economy';
import { checkBuildable, countBuildings, nextCost } from '../../sim/construction';
import { isBuildingUnlocked, maxBuildingCount } from '../../sim/modifiers';
import { startPlacing } from '../actions';
import { Cost } from '../common/Bits';
import { Icon } from '../common/Icon';
import { BuildingThumb } from '../common/Portrait';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';

type Tab = 'all' | BuildingCategory;

export function BuildMenu() {
  useGameState();
  const open = useUI((s) => s.panel === 'build');
  const highlight = useUI((s) => s.buildHighlight);
  const [tab, setTab] = useState<Tab>('all');
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !highlight) return;
    const el = rowRef.current?.querySelector(`[data-building="${highlight}"]`);
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [open, highlight]);
  if (!open) return null;
  const tabs: Tab[] = ['all', 'essentials', 'storage', 'homes', 'decor'];
  const items = BUILD_MENU_ORDER.filter((id) => tab === 'all' || BUILDINGS[id].category === tab);
  return (
    <div className="build-menu panel slide-up">
      <header>
        <h3>
          <Icon name="hammerHouse" size={26} /> Build
        </h3>
        <div className="tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'all' ? 'All' : BUILDING_CATEGORY_LABEL[t]}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => ui.set({ panel: null, buildHighlight: null })} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="build-row" ref={rowRef}>
        {items.map((id) => (
          <BuildCard key={id} id={id} highlight={highlight === id} />
        ))}
      </div>
    </div>
  );
}

function BuildCard({ id, highlight }: { id: BuildingId; highlight: boolean }) {
  const state = useGameState();
  const def = BUILDINGS[id];
  const unlocked = isBuildingUnlocked(state, id);
  const count = countBuildings(state, id);
  const max = maxBuildingCount(state, id);
  const buildable = checkBuildable(state, id);
  const cost = nextCost(state, id);
  const affordable = canAfford(state, cost.resources);
  let reason: string | null = null;
  if (!unlocked && def.requiresResearch) reason = `Research ${RESEARCH[def.requiresResearch].name}`;
  else if (!buildable.ok) reason = count >= max ? (id === 'cottage' ? 'Research more homes to build another' : 'Limit reached') : buildable.reason;
  else if (!affordable) reason = 'Need more resources';
  const disabled = !buildable.ok;
  return (
    <button
      data-building={id}
      className={`build-card ${disabled ? 'locked' : ''} ${!affordable && !disabled ? 'poor' : ''} ${highlight ? 'highlight' : ''}`}
      onClick={() => (disabled ? null : startPlacing(id))}
      aria-disabled={disabled}
    >
      <span className="bc-thumb">
        <BuildingThumb id={id} size={84} />
        {!unlocked ? (
          <span className="bc-lock">
            <Icon name="lock" size={26} />
          </span>
        ) : null}
      </span>
      <strong>{def.name}</strong>
      <span className="bc-count">
        {count}/{max}
      </span>
      <Cost bundle={cost.resources} state={state} compact />
      {cost.work > 0 ? (
        <small className="bc-work">
          <Icon name="build" size={14} /> {cost.work} work
        </small>
      ) : (
        <small className="bc-work">Instant</small>
      )}
      {def.storage ? (
        <small className="bc-perk">
          Stores {Object.entries(def.storage).map(([r, n]) => `${n} ${RESOURCES[r as keyof typeof RESOURCES].name}`).join(', ')}
        </small>
      ) : def.housing ? (
        <small className="bc-perk">+{def.housing} villager</small>
      ) : def.operate ? (
        <small className="bc-perk">1 worker slot</small>
      ) : null}
      {reason ? <small className="bc-reason">{reason}</small> : null}
    </button>
  );
}
