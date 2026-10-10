import { useCallback, useSyncExternalStore } from 'react';
import type { Insets } from '../rendering/CameraController';

/**
 * Screen-size facts the HUD adapts to. The media queries match the "Phone" blocks in
 * global.css: narrow portrait screens, and landscape screens too short for the desktop
 * layout.
 */
const COMPACT = '(max-width: 720px), (max-height: 520px)';
const SHORT = '(max-height: 520px) and (orientation: landscape)';

function query(q: string): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null;
}

const compactQuery = query(COMPACT);
const shortQuery = query(SHORT);

/** Phone-sized screen (either orientation). */
export function isCompact(): boolean {
  return compactQuery?.matches ?? false;
}

function subscribe(q: MediaQueryList | null) {
  return (fn: () => void) => {
    q?.addEventListener('change', fn);
    return () => q?.removeEventListener('change', fn);
  };
}
const subscribeCompact = subscribe(compactQuery);

export function useCompact(): boolean {
  return useSyncExternalStore(subscribeCompact, isCompact);
}

/**
 * Extra interface scale for this screen, on top of the player's own setting: a phone on
 * its side has very little height, so the whole HUD shrinks a little there.
 */
export function screenScale(): number {
  return shortQuery?.matches ? 0.8 : 1;
}

/** Calls `fn` when the screen class changes (rotating a phone). */
export function onScreenChange(fn: () => void): void {
  shortQuery?.addEventListener('change', fn);
}

/**
 * Publishes an element's top or bottom edge (interface units, measured within the UI
 * layer) as a CSS variable on the root, kept current as it resizes — so neighbouring HUD
 * pieces can make room for it, e.g. panels hang from the top bar's bottom edge. Returns
 * a ref callback, so it follows the element through mounts and unmounts.
 */
export function useEdgeVar<T extends HTMLElement>(name: string, edge: 'top' | 'bottom'): (el: T | null) => (() => void) | undefined {
  return useCallback(
    (el: T | null) => {
      if (!el) return undefined;
      const publish = () => document.documentElement.style.setProperty(name, `${edge === 'top' ? el.offsetTop : el.offsetTop + el.offsetHeight}px`);
      publish();
      const ro = new ResizeObserver(publish);
      ro.observe(el);
      window.addEventListener('resize', publish);
      return () => {
        ro.disconnect();
        window.removeEventListener('resize', publish);
        document.documentElement.style.removeProperty(name);
      };
    },
    [name, edge],
  );
}

/**
 * On a phone, the part of the screen left open around the selection sheet (a bottom
 * sheet in portrait, a side panel in landscape) and the top HUD, as the fraction of the
 * width/height covered on each side. Null when nothing covers the view.
 */
export function openArea(): Insets | null {
  if (!isCompact()) return null;
  const sheet = document.querySelector('.selection-panel')?.getBoundingClientRect();
  if (!sheet) return null;
  const w = window.innerWidth;
  const h = window.innerHeight;
  let top = 0;
  for (const sel of ['.topbar', '.worker-list']) {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (r) top = Math.max(top, r.bottom);
  }
  const bottomSheet = sheet.width > w * 0.7;
  return {
    top: Math.min(0.5, top / h),
    bottom: bottomSheet ? Math.max(0, Math.min(0.75, (h - sheet.top) / h)) : 0,
    left: 0,
    right: bottomSheet ? 0 : Math.max(0, Math.min(0.6, (w - sheet.left) / w)),
  };
}
