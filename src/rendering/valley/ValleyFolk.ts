import { BALANCE } from '../../config/balance';
import { DISTRICTS, NEIGHBOURS, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingId } from '../../config/valley';
import type { ResourceId } from '../../config/resources';
import { buildRoute, findPath, routeEnd } from '../../sim/pathfinding';
import { createVillager } from '../../sim/population';
import type { GameState, Vec2, Villager } from '../../sim/types';
import type { ValleyMember } from '../../valley/types';
import { APPEARANCE_PALETTE, type Appearance } from '../../config/villagers';
import type { World } from '../../sim/world';
import { createRng } from '../../world/noise';

type Errand = 'toProject' | 'building' | 'stroll' | 'pause';

interface Walker {
  /** Valley member this walker belongs to. */
  member: string;
  villager: Villager;
  village: string;
  errand: Errand;
  until: number;
  project: ValleyBuildingId | null;
}

const HELPER_NAMES = ['Ash', 'Bryn', 'Cora', 'Dell', 'Eda', 'Finch', 'Gale', 'Hob', 'Ivy', 'Jory'];
const PARCELS: ResourceId[] = ['timber', 'clay'];

/** A stable look for another player, derived from their id. */
function appearanceFor(id: string): Appearance {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const pick = <T>(list: readonly T[], salt: number) => list[((h >>> salt) ^ (h >>> (salt + 7))) % list.length];
  return {
    skin: pick(APPEARANCE_PALETTE.skin, 1),
    hair: pick(APPEARANCE_PALETTE.hair, 3),
    hairStyle: (((h >>> 5) & 3) as Appearance['hairStyle']),
    shirt: pick(APPEARANCE_PALETTE.shirt, 9),
    trousers: pick(APPEARANCE_PALETTE.trousers, 11),
    hat: ((h >>> 13) % 3) as Appearance['hat'],
    hatColor: pick(APPEARANCE_PALETTE.hatColor, 15),
  };
}

/**
 * Neighbours and their helpers going about the Valley: carrying parcels to whatever
 * is being restored, hammering on site, then strolling between districts. Purely
 * cosmetic and render-clocked — they are a picture of the simulated neighbours, not
 * part of any simulation.
 */
export class ValleyFolk {
  private readonly walkers: Walker[] = [];
  private readonly rng = createRng(4049);
  /** The player's own villagers away training, shown at their guild. Keyed by village id. */
  private readonly trainees = new Map<number, { villager: Villager; label: string }>();

  constructor(
    private readonly world: World,
    readonly scenery: GameState,
  ) {}

  private addWalker(member: string, name: string, village: string, appearance: Appearance): void {
    const v = createVillager(this.scenery, { name, appearance }, null, this.randomSpot());
    this.scenery.villagers.push(v);
    this.walkers.push({ member, villager: v, village, errand: 'pause', until: this.rng() * 4, project: null });
  }

  /**
   * Matches the walkers to the Valley's active members: each neighbour and a helper,
   * one figure per other player. Neighbours who moved on (and players who left) go.
   */
  syncMembers(members: readonly ValleyMember[], me: string): void {
    const active = new Set(members.filter((m) => m.leftAt === null && m.id !== me).map((m) => m.id));
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      if (active.has(w.member)) continue;
      this.scenery.villagers.splice(this.scenery.villagers.indexOf(w.villager), 1);
      this.walkers.splice(i, 1);
    }
    const present = new Set(this.walkers.map((w) => w.member));
    for (const m of members) {
      if (!active.has(m.id) || present.has(m.id)) continue;
      if (m.kind === 'simulated' && m.neighbour !== null) {
        const n = NEIGHBOURS[m.neighbour];
        const i = m.neighbour;
        this.addWalker(m.id, n.name, n.villageName, n.appearance);
        this.addWalker(m.id, HELPER_NAMES[i % HELPER_NAMES.length], n.villageName, { ...n.appearance, shirt: NEIGHBOURS[(i + 3) % NEIGHBOURS.length].appearance.shirt, hat: 0 });
      } else {
        this.addWalker(m.id, m.name, m.villageName, appearanceFor(m.id));
      }
    }
  }

  /** Name tag for a walker ("Rowan of Brackenford"). */
  labelFor(v: Villager): string {
    for (const t of this.trainees.values()) if (t.villager === v) return t.label;
    const w = this.walkers.find((x) => x.villager === v);
    return w ? `${v.name} of ${w.village}` : v.name;
  }

  private randomSpot(): Vec2 {
    const ids = Object.keys(DISTRICTS) as (keyof typeof DISTRICTS)[];
    for (let tries = 0; tries < 20; tries++) {
      const d = DISTRICTS[ids[Math.floor(this.rng() * ids.length)]];
      const p = this.world.grid.nearestWalkable({ x: d.x + (this.rng() - 0.5) * 8, z: d.z + (this.rng() - 0.5) * 8 }, 8);
      if (p) return p;
    }
    return { x: 64, z: 72 };
  }

  private projectSpot(id: ValleyBuildingId): Vec2 {
    const def = VALLEY_BUILDINGS[id];
    const out = def.radius + 1.2;
    const side = (this.rng() - 0.5) * def.radius * 1.4;
    const fx = Math.sin(def.facing);
    const fz = Math.cos(def.facing);
    const p = { x: def.x + fx * out + fz * side, z: def.z + fz * out - fx * side };
    return this.world.grid.nearestWalkable(p, 6) ?? p;
  }

  private walk(w: Walker, to: Vec2, now: number): boolean {
    const v = w.villager;
    const path = findPath(this.world.grid, v.pos, to);
    if (!path || path.length < 2) return false;
    const speed = BALANCE.villager.walkSpeed * (v.carrying ? BALANCE.villager.carrySpeedMult : 1) * 0.9;
    v.route = buildRoute(this.world.grid, path, now, speed, BALANCE.villager.pathSpeedMult);
    v.activity = 'walking';
    w.until = routeEnd(v.route);
    return true;
  }

  private arrive(v: Villager): void {
    if (v.route) v.pos = { ...v.route.points[v.route.points.length - 1] };
    v.route = null;
  }

  /** Advance every walker's errand to `now` (seconds of render time). */
  update(now: number, open: ValleyBuildingId[]): void {
    this.scenery.time = now;
    for (const w of this.walkers) {
      if (now < w.until) continue;
      const v = w.villager;
      switch (w.errand) {
        case 'toProject':
          this.arrive(v);
          v.carrying = null;
          v.activity = 'working';
          v.job = { kind: 'construct', buildingId: -1 };
          w.errand = 'building';
          w.until = now + 8 + this.rng() * 10;
          break;
        case 'building':
        case 'stroll':
          if (w.errand === 'stroll') this.arrive(v);
          v.job = null;
          v.activity = 'idle';
          w.errand = 'pause';
          w.until = now + 3 + this.rng() * 8;
          break;
        case 'pause': {
          const project = open.length > 0 && this.rng() < 0.6 ? open[Math.floor(this.rng() * open.length)] : null;
          if (project) {
            v.carrying = { resource: PARCELS[Math.floor(this.rng() * PARCELS.length)], amount: 1 };
            if (this.walk(w, this.projectSpot(project), now)) {
              w.errand = 'toProject';
              w.project = project;
              break;
            }
            v.carrying = null;
          }
          if (this.walk(w, this.randomSpot(), now)) w.errand = 'stroll';
          else w.until = now + 2;
          break;
        }
      }
    }
  }

  /** Mirrors the player's villagers who are away training: they stand at their guild's door. */
  syncTrainees(villagers: readonly Villager[], villageName: string): void {
    const away = villagers.filter((v) => v.activity === 'away' && v.away);
    const keep = new Set<number>();
    for (const v of away) {
      keep.add(v.id);
      if (this.trainees.has(v.id)) continue;
      const trip = v.away!;
      const guild = trip.kind === 'lesson' ? VALLEY_BUILDING_ORDER.find((id) => VALLEY_BUILDINGS[id].trains === trip.skill)! : 'millraceWorkshop';
      const def = VALLEY_BUILDINGS[guild];
      const n = [...this.trainees.values()].length;
      const fx = Math.sin(def.facing);
      const fz = Math.cos(def.facing);
      const side = ((n % 3) - 1) * 0.9;
      const spot = { x: def.x + fx * (def.radius + 0.6) + fz * side, z: def.z + fz * (def.radius + 0.6) - fx * side };
      const copy = createVillager(this.scenery, { name: v.name, appearance: v.appearance }, null, spot);
      this.scenery.villagers.push(copy);
      this.trainees.set(v.id, { villager: copy, label: `${v.name} of ${villageName} · ${trip.kind === 'lesson' ? 'training' : 'on shift'}` });
    }
    for (const [id, t] of this.trainees) {
      if (keep.has(id)) continue;
      this.scenery.villagers.splice(this.scenery.villagers.indexOf(t.villager), 1);
      this.trainees.delete(id);
    }
  }

  /** Projects being worked on, in a stable order (for picking errands). */
  static openProjects(statusOf: (id: ValleyBuildingId) => string | undefined): ValleyBuildingId[] {
    return VALLEY_BUILDING_ORDER.filter((id) => {
      const s = statusOf(id);
      return s === 'collecting' || s === 'building';
    });
  }
}
