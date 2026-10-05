import { jobSlots, workersOn } from './commands';
import { addResource } from './economy';
import type { EventSink } from './events';
import { completeShift } from './millrace';
import { completeLesson } from './training';
import type { AwayTrip, GameState, Lesson, Shift, Villager } from './types';
import { beginTrip, goRest, goToWork, jobTypeOf, valleyRoadSpot, walkTo } from './villagerAI';
import type { World } from './world';

/**
 * Trips to the Valley — guild lessons and workshop shifts share one shape: the villager
 * leaves their job, walks out along the road, is `away` until a timer in the village
 * simulation (so trips end during offline catch-up too), then comes back in at the road
 * and picks their old job back up if nobody took the slot.
 */

export type NewTrip = Omit<Lesson, 'until' | 'resumeJob'> | Omit<Shift, 'until' | 'resumeJob'>;

export function leaveForValley(state: GameState, world: World, v: Villager, trip: NewTrip): void {
  const resumeJob = v.job;
  v.job = null;
  v.workProgress = 0;
  v.batchWork = 0;
  v.depositTargetId = null;
  v.blockedReason = null;
  if (v.carrying) {
    addResource(state, v.carrying.resource, v.carrying.amount);
    v.carrying = null;
  }
  v.away = { ...trip, until: null, resumeJob } as AwayTrip;
  if (!walkTo(state, world, v, valleyRoadSpot(world), 'toValley')) {
    // Can't reach the road (shouldn't happen): set off from where they stand.
    v.route = null;
    v.purpose = null;
    beginTrip(state, v);
  }
}

/** The trip is over: its outcome, then home and back to work. */
export function finishTrip(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const trip = v.away!;
  if (trip.kind === 'lesson') completeLesson(v, trip, sink);
  else completeShift(state, v, trip, sink);
  v.away = null;
  v.pos = valleyRoadSpot(world);
  v.activity = 'idle';
  const job = trip.resumeJob;
  if (job && jobTypeOf(state, job) && workersOn(state, job, v.id).length < jobSlots(state, job)) {
    v.job = job;
    goToWork(state, world, v, sink);
  } else {
    goRest(state, world, v);
  }
}
