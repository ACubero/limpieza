const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const paths = {
  calendar: `<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>`,
  clipboard: `<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 10h6M9 14h6M9 18h3"/>`,
  users: `<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.9c1.6.7 2.7 2.2 3 4.1"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8l1 2.4a7 7 0 0 1 2.3 1l2.5-.8 1.8 3.1-1.7 2a7 7 0 0 1 0 2.8l1.7 2-1.8 3.1-2.5-.8a7 7 0 0 1-2.3 1l-1 2.4-3.6 0-1-2.4a7 7 0 0 1-2.3-1l-2.5.8-1.8-3.1 1.7-2a7 7 0 0 1 0-2.8l-1.7-2 1.8-3.1 2.5.8a7 7 0 0 1 2.3-1l1-2.4z" stroke-width="1.5"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  trash: `<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>`,
  copy: `<rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>`,
  duplicate: `<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 4H6a3 3 0 0 0-3 3v10M14.5 11.5v6M11.5 14.5h6"/>`,
  warning: `<path d="M12 3.5L21.5 20h-19L12 3.5zM12 10v4.5M12 17.5v.1"/>`,
  check: `<path d="M4.5 12.5l5 5L19.5 6.5"/>`,
  x: `<path d="M6 6l12 12M18 6L6 18"/>`,
  back: `<path d="M15 5l-7 7 7 7"/>`,
  chevR: `<path d="M9 5l7 7-7 7"/>`,
  edit: `<path d="M4 20h4l11-11a2.2 2.2 0 0 0-3.1-3.1L5 17l-1 4zM13.5 7.5l3 3"/>`,
  image: `<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M3.5 18l5-5 4 4 3.5-3.5 4.5 4.5"/>`,
  pdf: `<path d="M6 2.5h8L19.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V4A1.5 1.5 0 0 1 6 2.5zM14 2.5V8h5.5"/><path d="M8 16.5h8M8 13h8" stroke-width="1.5"/>`,
  whatsapp: `<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c-.3 2.6 3 6.3 6 6.5.8 0 1.6-.4 1.6-1.2 0-.5-1-1.2-1.6-1.3-.5 0-.8.6-1.3.5-1-.3-2.4-1.7-2.7-2.6-.1-.5.6-.8.6-1.3 0-.5-.7-1.6-1.2-1.7-.7-.1-1.3.5-1.4 1.1z" stroke-width="1.4"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2.5"/>`,
  download: `<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>`,
  upload: `<path d="M12 15V4M7 8l5-5 5 5M4 20h16"/>`,
  logout: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>`,
  male: `<circle cx="10" cy="14" r="5.5"/><path d="M14 10l6-6M14.5 4H20v5.5"/>`,
  female: `<circle cx="12" cy="9" r="5.5"/><path d="M12 14.5V21M9 18.5h6"/>`,
  broom: `<path d="M14.5 3.5L11 10M11 10l-6.7 4.2a1 1 0 0 0-.2 1.5l4.2 4.2a1 1 0 0 0 1.5-.2L14 13M11 10l3 3M6 16l2 2M8.5 13.5l2 2"/>`,
  sparkle: `<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>`,
  auto: `<path d="M5 16l2.2-6 2.2 6M5.8 14h3M12.5 10h4l-4 6h4"/><rect x="2.5" y="5.5" width="19" height="14" rx="3"/>`,
  share: `<circle cx="6" cy="12" r="2.5"/><circle cx="17" cy="6" r="2.5"/><circle cx="17" cy="18" r="2.5"/><path d="M8.3 10.8l6.4-3.6M8.3 13.2l6.4 3.6"/>`,
  history: `<path d="M4 12a8 8 0 1 1 2.3 5.7M4 12H2.5M4 12l-1.8 2.5M12 8v4.5l3 2"/>`,
  eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 6 10 6c1.5 0 2.9-.3 4.1-.8M9.5 9.5a3 3 0 0 0 4.2 4.2"/>`,
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" ${S} aria-hidden="true">${paths[name] || ''}</svg>`;
}
