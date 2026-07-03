// Custom cursors: a pale gauntlet for wandering, a bared sword for prey.
// Inline SVG data URIs stay crisp at any DPI and cost nothing per frame.

function css(svg: string, hx: number, hy: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, ${fallback}`;
}

// A mailed hand, index finger pointing. Hotspot at the fingertip.
const HAND = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
<path d="M9 2.5h3v9h2.5V10h3v1.5h2v6.2l-2.5 3.8h-8l-3.5-5v-3h2L9 15z"
 fill="#cfd3d8" stroke="#0a0a0c" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M7.5 18h10" stroke="#0a0a0c" stroke-width="1.2" opacity="0.55"/>
<path d="M9.6 3.4v7.4" stroke="#8f959d" stroke-width="1" opacity="0.8"/>
</svg>`;

// A sword angled tip-up-left. Hotspot at the point.
const SWORD = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
<path d="M2.5 2.5L13.8 11.6 12.7 12.7 11.6 13.8z" fill="#dfe4ea" stroke="#0a0a0c" stroke-width="1.3" stroke-linejoin="round"/>
<path d="M3.6 3.6L12.3 12.3" stroke="#9aa1a9" stroke-width="0.8"/>
<path d="M9.9 15.3L15.3 9.9" stroke="#0a0a0c" stroke-width="4"/>
<path d="M9.9 15.3L15.3 9.9" stroke="#8f959d" stroke-width="2.4"/>
<path d="M13.6 13.6L17.4 17.4" stroke="#0a0a0c" stroke-width="4"/>
<path d="M13.6 13.6L17.4 17.4" stroke="#3a3e45" stroke-width="2.4"/>
<circle cx="18.8" cy="18.8" r="1.8" fill="#9aa1a9" stroke="#0a0a0c" stroke-width="1.2"/>
</svg>`;

export const CURSOR_HAND = css(HAND, 10, 2, 'pointer');
export const CURSOR_SWORD = css(SWORD, 3, 3, 'crosshair');
