/**
 * Tutorial beats. Completion conditions are evaluated in `game/tutorial.ts`; this file
 * only holds the words so they can be edited without touching logic.
 */
export type TutorialStepId =
  | 'welcome'
  | 'assignTimber'
  | 'assignCook'
  | 'gatherTimber'
  | 'buildAcademy'
  | 'research'
  | 'buildCottage'
  | 'meetNewcomer'
  | 'done';

export interface TutorialStepDef {
  id: TutorialStepId;
  title: string;
  body: string;
  /** Short imperative shown on the coach chip when collapsed. */
  hint: string;
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome to your clearing',
    body: 'Two settlers, a cookhouse and a lot of wilderness. Every villager matters here — you decide what each of them does.',
    hint: 'Let’s begin',
  },
  {
    id: 'assignTimber',
    title: 'Cut some timber',
    body: 'Tap a tree near the Timber Yard, then choose a villager to fell it. They’ll carry the logs back to storage by themselves.',
    hint: 'Assign a villager to a tree',
  },
  {
    id: 'assignCook',
    title: 'Keep everyone fed',
    body: 'Working villagers eat Stew. Tap the Cookhouse and put your other villager on the pot.',
    hint: 'Assign a cook',
  },
  {
    id: 'gatherTimber',
    title: 'Stock up',
    body: 'An Academy costs 60 Timber. Watch the Timber counter climb — you can speed things up by moving the cook onto a second tree once the pantry is full.',
    hint: 'Gather 60 Timber',
  },
  {
    id: 'buildAcademy',
    title: 'Raise an Academy',
    body: 'Open Build, place the Academy somewhere in the clearing, then assign a builder to the construction site.',
    hint: 'Build the Academy',
  },
  {
    id: 'research',
    title: 'Study something new',
    body: 'Assign a scholar to the Academy, open Research and pick Cottage Craft. Knowledge flows into whatever you are researching.',
    hint: 'Research Cottage Craft',
  },
  {
    id: 'buildCottage',
    title: 'Make room for one more',
    body: 'Cottage Craft is ready. Build a Cottage — every new home brings a new villager.',
    hint: 'Build a Cottage',
  },
  {
    id: 'meetNewcomer',
    title: 'A traveller arrives',
    body: 'Someone has heard about your village. Pick who joins you — each newcomer arrives with a skill they already practise.',
    hint: 'Welcome your newcomer',
  },
  {
    id: 'done',
    title: 'Your village is on its way',
    body: 'From here on, you choose the path: more villagers, better storage, clay, faster crafts. Check “Next steps” whenever you’re unsure.',
    hint: 'Tutorial complete',
  },
];
