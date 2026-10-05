import { useState } from 'react';
import { COOP_RECIPES, COOP_RECIPE_ORDER, MILLRACE, type CoopRecipeId } from '../../config/millrace';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { VALLEY_BUILDINGS, VALLEY_BUILDING_ORDER, type ValleyBuildingId } from '../../config/valley';
import { shiftOutput, shiftYield } from '../../sim/millrace';
import type { Shift } from '../../sim/types';
import type { ValleySnapshot } from '../../valley/types';
import { millraceCrew, remainingFor } from '../../valley/valleySim';
import { sendOnShift } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { Portrait } from '../common/Portrait';
import { formatDuration, formatNumber, useGameState } from '../hooks';

/** Shifts at the Millrace: who's on, what to make, and which project gets it. */
export function MillraceSection({ snapshot, serverNow }: { snapshot: ValleySnapshot; serverNow: number }) {
  const state = useGameState();
  const crew = millraceCrew(snapshot, serverNow);
  const free = state.villagers.filter((v) => !v.away);
  const [recipe, setRecipe] = useState<CoopRecipeId>('beams');
  const [who, setWho] = useState<number | null>(null);
  const def = COOP_RECIPES[recipe];
  const out = def.output.resource;
  // Projects that still want what this recipe makes.
  const projects = VALLEY_BUILDING_ORDER.filter((id) => snapshot.buildings[id].status === 'collecting' && (remainingFor(snapshot.buildings[id])[out] ?? 0) > 0);
  const [project, setProject] = useState<ValleyBuildingId | null>(null);
  const target = project && projects.includes(project) ? project : (projects[0] ?? null);
  const villager = free.find((v) => v.id === who) ?? [...free].sort((a, b) => b.skills.crafting.level - a.skills.crafting.level)[0] ?? null;
  const yieldMult = villager ? shiftYield(state, villager, crew.length) : 1;
  const made = shiftOutput(recipe, yieldMult);
  const affordable = (Object.entries(def.inputs) as [ResourceId, number][]).every(([r, n]) => state.resources[r] >= n);
  const onShift = state.villagers.filter((v) => v.away?.kind === 'shift');
  return (
    <Section title="Shifts" aside={<small className="muted">{crew.length > 0 ? `${crew.join(', ')} on shift` : 'Nobody else on shift'}</small>}>
      <p className="small muted">
        Send a villager with materials for a {MILLRACE.shiftHours}h shift. The shared saws and kiln make more than you would alone (+{MILLRACE.helperBonus * 100}% for each neighbour on shift, +
        {MILLRACE.craftingBonusPerLevel * 100}% per Crafting level), and the goods go straight to a Valley project.
      </p>
      {onShift.map((v) => {
        const s = v.away as Shift;
        const total = s.duration ?? MILLRACE.shiftHours * 3600;
        const res = shiftOutput(s.recipe, s.yield);
        return (
          <div key={v.id} className="trainee">
            <Portrait appearance={v.appearance} size={34} />
            <span className="tonic-name">
              <strong>
                {v.name}: {res.amount} {RESOURCES[res.resource].name} → {VALLEY_BUILDINGS[s.project].name}
              </strong>
              {s.until !== null ? <Bar value={1 - (s.until - state.time) / total} tone="blue" thin /> : <small>On the road here…</small>}
            </span>
            {s.until !== null ? <small className="muted">{formatDuration(s.until - state.time)}</small> : null}
          </div>
        );
      })}
      <div className="seg recipes">
        {COOP_RECIPE_ORDER.map((id) => (
          <button key={id} className={recipe === id ? 'active' : ''} onClick={() => setRecipe(id)}>
            {COOP_RECIPES[id].name}
          </button>
        ))}
      </div>
      <div className="shift-plan">
        <span className="shift-io">
          {(Object.entries(def.inputs) as [ResourceId, number][]).map(([r, n]) => (
            <span key={r} className={state.resources[r] < n ? 'short' : ''}>
              <Icon name={r} size={20} />
              {n}
            </span>
          ))}
          <Icon name="travel" size={20} />
          <span>
            <Icon name={out} size={20} />
            {formatNumber(made.amount)}
          </span>
        </span>
        <label>
          Who
          <select value={villager?.id ?? ''} onChange={(e) => setWho(Number(e.target.value))}>
            {free.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} (Crafting {v.skills.crafting.level})
              </option>
            ))}
          </select>
        </label>
        <label>
          For
          <select value={target ?? ''} onChange={(e) => setProject(e.target.value as ValleyBuildingId)}>
            {projects.map((id) => (
              <option key={id} value={id}>
                {VALLEY_BUILDINGS[id].name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn green wide" disabled={!villager || !target || !affordable} onClick={() => villager && target && sendOnShift(villager.id, recipe, target, crew.length)}>
        <Icon name="travel" size={20} />
        {!target ? `No project needs ${RESOURCES[out].name.toLowerCase()} right now` : !affordable ? 'Not enough materials' : `Send ${villager?.name ?? ''} for a shift`}
      </button>
      <p className="small muted">{villager ? `${villager.name} leaves their job for the shift and comes back to it afterwards.` : 'Everyone is away right now.'}</p>
    </Section>
  );
}
