/**
 * Every player-facing proper noun lives here so the game can be renamed in one place.
 */
export const IDENTITY = {
  gameTitle: 'Project Valley',
  tagline: 'Grow a peaceful settlement, one villager at a time.',
  defaultVillageName: 'Thistledown',
  valleyName: 'The Hearthlands',
  /** Prefix for browser storage keys. Changing it orphans existing local caches. */
  storageKeyPrefix: 'project-valley',
} as const;
