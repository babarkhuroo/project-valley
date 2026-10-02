/**
 * Original icon set: chunky shapes with a warm dark outline so they read at small
 * sizes over both the 3D world and parchment panels. Stored as SVG markup so the
 * same icons serve React components and the imperative world overlay.
 */
const O = '#3b2f2a';
const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  timber: svg(
    `<g stroke="${O}" stroke-width="1.4" stroke-linejoin="round">
      <rect x="3" y="12.5" width="15" height="6" rx="3" fill="#b7773f"/>
      <ellipse cx="18" cy="15.5" rx="2.6" ry="3" fill="#e8c28a"/>
      <rect x="5" y="6" width="15" height="6" rx="3" fill="#c98548"/>
      <ellipse cx="20" cy="9" rx="2.6" ry="3" fill="#f0cf98"/>
    </g>
    <circle cx="18" cy="15.5" r="1" fill="#b7773f"/><circle cx="20" cy="9" r="1" fill="#c98548"/>`,
  ),
  clay: svg(
    `<path d="M4 17c0-4 3-8 8-8s8 4 8 8c0 1.8-1.4 3-3 3H7c-1.7 0-3-1.2-3-3z" fill="#d0673f" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M8 12.5c1.5-1.4 3-2 5-1.8" stroke="#f0a27c" stroke-width="1.6" fill="none" stroke-linecap="round"/>
     <circle cx="15.5" cy="15" r="1.2" fill="#a84e2e"/><circle cx="9.5" cy="16.5" r="0.9" fill="#a84e2e"/>`,
  ),
  stone: svg(
    `<path d="M3.5 15l3-6 6-2.5 6 2 2.5 6.5-4 4H8z" fill="#a7adb7" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M6.5 9l5.5 2.5 6-2M12 11.5V19" stroke="${O}" stroke-width="1.1" fill="none" opacity=".55"/>
     <path d="M8 13.5l2.5 1.2" stroke="#e4e7ec" stroke-width="1.3" stroke-linecap="round"/>`,
  ),
  quarry: svg(
    `<path d="M7 21l8.5-12" stroke="#8a5a3b" stroke-width="2.4" stroke-linecap="round"/>
     <path d="M5 6.5c3.5-3 9.5-3.5 14-1-3.5-.4-6.4.6-8.6 3.2z" fill="#b9c3cf" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M11.4 8.7c2.3-2.4 5.3-3.3 7.6-3.2" stroke="${O}" stroke-width="1" fill="none" opacity=".5"/>`,
  ),
  planks: svg(
    `<g stroke="${O}" stroke-width="1.3" stroke-linejoin="round">
      <path d="M3 15.5l14-5 4 2-14 5z" fill="#d9a865"/>
      <path d="M3 15.5v2.5l4 2v-2.5zM7 17.5v2.5l14-5v-2.5z" fill="#b8844a"/>
      <path d="M3 10.5l14-5 4 2-14 5z" fill="#e8bd80"/>
      <path d="M3 10.5V13l4 2v-2.5zM7 12.5V15l14-5V7.5z" fill="#c9955a"/>
    </g>`,
  ),
  bricks: svg(
    `<g stroke="${O}" stroke-width="1.3" stroke-linejoin="round">
      <rect x="2.5" y="13" width="9" height="5.5" rx="1" fill="#c8603f"/>
      <rect x="12.5" y="13" width="9" height="5.5" rx="1" fill="#b8553a"/>
      <rect x="7.5" y="6.5" width="9" height="5.5" rx="1" fill="#d97553"/>
    </g>`,
  ),
  craft: svg(
    `<path d="M3 15.5L15 5l5 5-12 10.5z" fill="#cfd6df" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M5.5 17.5l1.2-1.3M8 19.6l1.2-1.3M3.6 15.4l1.2-1.3" stroke="${O}" stroke-width="1.1" stroke-linecap="round"/>
     <rect x="14" y="2.5" width="6.5" height="5" rx="1.5" transform="rotate(42 17.2 5)" fill="#8a5a3b" stroke="${O}" stroke-width="1.4"/>`,
  ),
  crate: svg(
    `<rect x="3.5" y="5.5" width="17" height="14" rx="1.6" fill="#d7a86e" stroke="${O}" stroke-width="1.4"/>
     <path d="M3.5 10.2h17M3.5 14.8h17" stroke="${O}" stroke-width="1.1" opacity=".55"/>
     <path d="M5 6.5l14 12M19 6.5l-14 12" stroke="#8a5a3b" stroke-width="1.6" stroke-linecap="round"/>`,
  ),
  upgrade: svg(
    `<circle cx="12" cy="12" r="9.5" fill="#9ee07c" stroke="${O}" stroke-width="1.4"/>
     <path d="M12 17V7.5M7.5 11.5L12 7l4.5 4.5" stroke="${O}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  stew: svg(
    `<path d="M5 8c2-1.5 1-3 3-4M11 8c2-1.5 1-3 3-4M17 8c2-1.5 1-3 3-4" stroke="#e8e0d4" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".9"/>
     <path d="M3 11h18c0 5-4 9-9 9s-9-4-9-9z" fill="#c9824a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <ellipse cx="12" cy="11" rx="9" ry="2.2" fill="#e8a93a" stroke="${O}" stroke-width="1.4"/>
     <circle cx="9" cy="10.8" r="1" fill="#8fd16b"/><circle cx="14" cy="11.2" r="1" fill="#d6455a"/>`,
  ),
  knowledge: svg(
    `<path d="M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="#8fa6f0" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <circle cx="12" cy="11" r="2.2" fill="#e5ebff"/>`,
  ),
  xp: svg(
    `<path d="M12 2.8l2.4 5 5.4.7-4 3.7 1 5.4L12 15l-4.8 2.6 1-5.4-4-3.7 5.4-.7z" fill="#f2c14e" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  idle: svg(
    `<circle cx="12" cy="12" r="9.5" fill="#fff6e0" stroke="${O}" stroke-width="1.4"/>
     <text x="12" y="16.2" font-family="Fredoka, sans-serif" font-weight="700" font-size="11" text-anchor="middle" fill="#6f8fe0">z</text>
     <text x="16.5" y="10" font-family="Fredoka, sans-serif" font-weight="700" font-size="7" text-anchor="middle" fill="#6f8fe0">z</text>`,
  ),
  hungry: svg(
    `<path d="M3 11h18c0 5-4 9-9 9s-9-4-9-9z" fill="#f4e6cc" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M12 3v5" stroke="#d9544a" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="10.5" r="0.2" fill="#d9544a" stroke="#d9544a" stroke-width="2.4"/>`,
  ),
  full: svg(
    `<rect x="3.5" y="7" width="17" height="13" rx="2.5" fill="#e8c28a" stroke="${O}" stroke-width="1.4"/>
     <path d="M3.5 11h17" stroke="${O}" stroke-width="1.4"/>
     <path d="M12 2.5v6" stroke="#d9544a" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.6" fill="#d9544a"/>`,
  ),
  chop: svg(
    `<path d="M6 21L15.5 8" stroke="#8a5a3b" stroke-width="2.6" stroke-linecap="round"/>
     <path d="M13 4.5c3-1.5 6.5-.5 7.5 2.5l-4.2 3.5c-1.3-1.8-2.6-3.8-3.3-6z" fill="#b9c3cf" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  dig: svg(
    `<path d="M5 3.5l9 9" stroke="#8a5a3b" stroke-width="2.4" stroke-linecap="round"/><path d="M3.5 5l3-3" stroke="#8a5a3b" stroke-width="2.4" stroke-linecap="round"/>
     <path d="M12.5 11.5l5.5-1.5 3 3-1.5 5.5c-1 2-4 2-5.5.5l-3.5-3.5c-1.5-1.5-1.5-4.5 2-4z" fill="#b9c3cf" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  cook: svg(
    `<path d="M4 10h16v4a8 6 0 0 1-16 0z" fill="#4a4a55" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <ellipse cx="12" cy="10" rx="8" ry="2" fill="#e8a93a" stroke="${O}" stroke-width="1.2"/>
     <path d="M15 9L20 2.5" stroke="#d7a86e" stroke-width="2" stroke-linecap="round"/>
     <path d="M8 21l-1.5 1.5M16 21l1.5 1.5" stroke="${O}" stroke-width="1.4" stroke-linecap="round"/>`,
  ),
  study: svg(
    `<path d="M3 5.5c3-1 6-1 9 1 3-2 6-2 9-1v13c-3-1-6-1-9 1-3-2-6-2-9-1z" fill="#fbf4e2" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M12 6.5v13" stroke="${O}" stroke-width="1.4"/>
     <path d="M5.5 9h4M5.5 12h4M14.5 9h4M14.5 12h4" stroke="#6f8fe0" stroke-width="1.2" stroke-linecap="round"/>`,
  ),
  build: svg(
    `<path d="M4 20l9-9" stroke="#8a5a3b" stroke-width="2.6" stroke-linecap="round"/>
     <rect x="10.5" y="3.5" width="10" height="6" rx="1.4" transform="rotate(45 15.5 6.5)" fill="#9aa4b1" stroke="${O}" stroke-width="1.4"/>`,
  ),
  carry: svg(
    `<rect x="4" y="9" width="16" height="11" rx="2.5" fill="#e0b98a" stroke="${O}" stroke-width="1.4"/>
     <path d="M8 9V6.5a4 4 0 0 1 8 0V9" stroke="${O}" stroke-width="1.4" fill="none"/>
     <path d="M4 13.5h16" stroke="${O}" stroke-width="1.2" opacity=".5"/>`,
  ),
  walk: svg(
    `<ellipse cx="8" cy="15.5" rx="2.6" ry="4" fill="#cfa66b" stroke="${O}" stroke-width="1.3"/>
     <ellipse cx="16" cy="8.5" rx="2.6" ry="4" fill="#cfa66b" stroke="${O}" stroke-width="1.3"/>`,
  ),
  blocked: svg(
    `<circle cx="12" cy="12" r="9.5" fill="#ffe2a8" stroke="${O}" stroke-width="1.4"/>
     <rect x="8.2" y="7.5" width="2.6" height="9" rx="1" fill="${O}"/><rect x="13.2" y="7.5" width="2.6" height="9" rx="1" fill="${O}"/>`,
  ),
  hammerHouse: svg(
    `<path d="M3 11.5L12 4l9 7.5" stroke="${O}" stroke-width="1.6" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
     <path d="M5.5 10v10h13V10L12 4.8z" fill="#f3e5c8" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M3 11.5L12 4l9 7.5" stroke="#d4674a" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
     <rect x="10" y="14" width="4" height="6" rx="1" fill="#8a5a3b"/>`,
  ),
  research: svg(
    `<path d="M9 3h6M10 3v5.5L4.8 17.5c-.9 1.6.2 3.5 2 3.5h10.4c1.8 0 2.9-1.9 2-3.5L14 8.5V3" fill="#e5ebff" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M6.5 15h11l1.6 2.8c.4.8-.1 1.7-1 1.7H5.9c-.9 0-1.4-.9-1-1.7z" fill="#8fa6f0"/>
     <circle cx="10.5" cy="12.5" r="1" fill="#8fa6f0"/><circle cx="13.5" cy="10.5" r=".8" fill="#8fa6f0"/>`,
  ),
  bell: svg(
    `<path d="M6 16V11a6 6 0 0 1 12 0v5l1.8 2H4.2z" fill="#f2c14e" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M10 20.5a2 2 0 0 0 4 0" stroke="${O}" stroke-width="1.4" fill="none"/>`,
  ),
  gear: svg(
    `<path d="M12 2.5l1.6 2.4 2.8-.6.8 2.7 2.7.8-.6 2.8 2.4 1.6-2.4 1.6.6 2.8-2.7.8-.8 2.7-2.8-.6L12 21.5l-1.6-2.4-2.8.6-.8-2.7-2.7-.8.6-2.8L2.5 12l2.4-1.6-.6-2.8 2.7-.8.8-2.7 2.8.6z" fill="#cfd6df" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>
     <circle cx="12" cy="12" r="3.2" fill="#fff" stroke="${O}" stroke-width="1.3"/>`,
  ),
  close: svg(`<path d="M6 6l12 12M18 6L6 18" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`),
  check: svg(`<path d="M4.5 12.5l5 5 10-11" stroke="#2f6b3a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`),
  rotate: svg(
    `<path d="M19 12a7 7 0 1 1-2.1-5" stroke="${O}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M18.5 2.5v5h-5" stroke="${O}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  move: svg(
    `<path d="M12 3v18M3 12h18" stroke="${O}" stroke-width="2" stroke-linecap="round"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" stroke="${O}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  trash: svg(
    `<path d="M5 7h14l-1.2 12.5c-.1 1-.9 1.5-1.8 1.5H8c-.9 0-1.7-.5-1.8-1.5z" fill="#f4b3a8" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M3.5 7h17M9.5 7V4.5h5V7" stroke="${O}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  ),
  lock: svg(
    `<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#cfd6df" stroke="${O}" stroke-width="1.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="${O}" stroke-width="1.6" fill="none"/><circle cx="12" cy="15.3" r="1.5" fill="${O}"/>`,
  ),
  home: svg(
    `<path d="M4 11L12 4l8 7v9H4z" fill="#f3e5c8" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M2.8 11.5L12 3.5l9.2 8" stroke="#d4674a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="10" y="14" width="4" height="6" rx="1" fill="#8a5a3b"/>`,
  ),
  villager: svg(
    `<circle cx="12" cy="8" r="4.5" fill="#f1c7a2" stroke="${O}" stroke-width="1.4"/><path d="M4.5 21c.5-4.5 3.5-7 7.5-7s7 2.5 7.5 7z" fill="#4f9a6a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  target: svg(
    `<circle cx="12" cy="12" r="8" fill="none" stroke="${O}" stroke-width="1.8"/><circle cx="12" cy="12" r="2.4" fill="${O}"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>`,
  ),
  clock: svg(
    `<circle cx="12" cy="12" r="9" fill="#fff6e0" stroke="${O}" stroke-width="1.4"/><path d="M12 7v5l3.5 2" stroke="${O}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,
  ),
  plus: svg(`<path d="M12 5v14M5 12h14" stroke="${O}" stroke-width="2.6" stroke-linecap="round"/>`),
  info: svg(
    `<circle cx="12" cy="12" r="9.5" fill="#e5ebff" stroke="${O}" stroke-width="1.4"/><path d="M12 11v6" stroke="${O}" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="7.5" r="1.4" fill="${O}"/>`,
  ),
  sound: svg(
    `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="#f2c14e" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke="${O}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`,
  ),
  leaf: svg(
    `<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15" fill="#8cc265" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 19l9-9" stroke="${O}" stroke-width="1.4" stroke-linecap="round"/>`,
  ),
  wrench: svg(
    `<path d="M14.5 3.5a5 5 0 0 0-4.8 6.4L3.5 16.1a2.1 2.1 0 0 0 3 3l6.2-6.2a5 5 0 0 0 6.4-4.8l-2.9 2.9-3.2-.9-.9-3.2z" fill="#cfd6df" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>`,
  ),
  compass: svg(
    `<circle cx="12" cy="12" r="9.5" fill="#fff6e0" stroke="${O}" stroke-width="1.4"/><path d="M12 5l2.5 7h-5z" fill="#d9544a"/><path d="M12 19l-2.5-7h5z" fill="#9aa4b1"/>`,
  ),
  valley: svg(
    `<path d="M1.5 19l6-9.5 4 5.5 3.5-5 7.5 9z" fill="#8cc265" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M5.4 12.8l2.1-3.3 1.6 2.2" fill="#f4f1ea" stroke="${O}" stroke-width="1" stroke-linejoin="round"/>
     <path d="M11 19c1-2 3.5-2.4 4-4.2" stroke="#e8d3a8" stroke-width="2" fill="none" stroke-linecap="round"/>
     <circle cx="18" cy="5.5" r="2.3" fill="#f4b83e" stroke="${O}" stroke-width="1.2"/>`,
  ),
  reputation: svg(
    `<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="#f08a7a" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M3 5.5l2 1.2M21 5.5l-2 1.2M12 2.5v2.2" stroke="#f4b83e" stroke-width="1.8" stroke-linecap="round"/>
     <path d="M8.2 10.5c.4-1 1.2-1.5 2.1-1.5" stroke="#ffd6cc" stroke-width="1.4" fill="none" stroke-linecap="round"/>`,
  ),
  gift: svg(
    `<rect x="3.5" y="9.5" width="17" height="11" rx="1.6" fill="#d9a865" stroke="${O}" stroke-width="1.4"/>
     <rect x="2.5" y="7" width="19" height="4" rx="1.2" fill="#e8bd80" stroke="${O}" stroke-width="1.4"/>
     <path d="M12 7v13.5" stroke="#d9544a" stroke-width="2.6"/>
     <path d="M12 7c-1.5-3.5-5-3.8-5-1.6S10 7 12 7c2 0 5 .6 5-1.6S13.5 3.5 12 7z" fill="#f08a7a" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>`,
  ),
  travel: svg(
    `<path d="M11 3.5v17.5" stroke="#8a5a3b" stroke-width="2.2" stroke-linecap="round"/>
     <path d="M11 5h8l2.5 2.5L19 10h-8z" fill="#f4b83e" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>
     <path d="M11 11.5H5L2.5 14 5 16.5h6z" fill="#8cc265" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>`,
  ),
  coin: svg(
    `<ellipse cx="12" cy="14.5" rx="8" ry="6" fill="#c98a1a" stroke="${O}" stroke-width="1.4"/>
     <ellipse cx="12" cy="11.5" rx="8" ry="6" fill="#f4b83e" stroke="${O}" stroke-width="1.4"/>
     <ellipse cx="12" cy="11.5" rx="4.6" ry="3.2" fill="none" stroke="#c98a1a" stroke-width="1.3"/>
     <path d="M10.6 10.2c.8-.6 2-.6 2.8 0" stroke="#fff3c4" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
  ),
  potion: svg(
    `<path d="M9.5 3.5h5M10.3 3.5v4.2L5.6 15.5a3.6 3.6 0 0 0 3.1 5h6.6a3.6 3.6 0 0 0 3.1-5l-4.7-7.8V3.5" fill="#e5f1ff" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M7 14h10l1.2 2a2.4 2.4 0 0 1-2.1 3.4H7.9A2.4 2.4 0 0 1 5.8 16z" fill="#8cc265"/>
     <circle cx="10" cy="16.5" r=".9" fill="#fff"/><circle cx="13.6" cy="15.3" r=".6" fill="#fff"/>`,
  ),
  ship: svg(
    `<path d="M3 15.5h18l-2.6 4.2c-.3.5-.8.8-1.4.8H7c-.6 0-1.1-.3-1.4-.8z" fill="#8a5a3b" stroke="${O}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M12 3v12.5" stroke="${O}" stroke-width="1.4"/>
     <path d="M12.6 4.2c3 2 4.6 5.2 4.6 9.3h-4.6z" fill="#fff8ea" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>
     <path d="M11.4 6.2c-2.4 1.7-3.8 4.2-3.8 7.3h3.8z" fill="#d9544a" stroke="${O}" stroke-width="1.3" stroke-linejoin="round"/>`,
  ),
} as const;

export type IconName = keyof typeof ICONS;
