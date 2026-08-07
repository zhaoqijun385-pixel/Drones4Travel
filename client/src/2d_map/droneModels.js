/** Quadcopter-style SVG markers for Mission Arena (Google + Leaflet). */

export function quadcopterSvgDataUrl(color, label, yawDeg = 0, scale = 1) {
  const size = Math.round(44 * scale);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <g transform="rotate(${yawDeg} 32 32)">
    <ellipse cx="32" cy="38" rx="10" ry="4" fill="rgba(0,0,0,0.28)"/>
    <circle cx="14" cy="14" r="7" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>
    <circle cx="50" cy="14" r="7" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>
    <circle cx="14" cy="50" r="7" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>
    <circle cx="50" cy="50" r="7" fill="${color}" fill-opacity="0.35" stroke="${color}" stroke-width="1.5"/>
    <line x1="20" y1="20" x2="44" y2="44" stroke="#1a2420" stroke-width="3" stroke-linecap="round"/>
    <line x1="44" y1="20" x2="20" y2="44" stroke="#1a2420" stroke-width="3" stroke-linecap="round"/>
    <rect x="24" y="24" width="16" height="16" rx="3" fill="${color}" stroke="#0a1614" stroke-width="1.5"/>
    <polygon points="32,18 36,24 28,24" fill="#f2f7f4"/>
    <text x="32" y="35" text-anchor="middle" font-size="10" font-family="sans-serif" font-weight="700" fill="#041018">${label}</text>
  </g>
</svg>`.trim();
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const DRONE_COLORS = {
  blue: '#4db6ff',
  red: '#ff6b5a',
  vip: '#d4c56a',
};
