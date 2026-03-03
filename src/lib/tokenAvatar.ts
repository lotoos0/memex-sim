const svgCache = new Map<string, string>();

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function buildSvg(tokenId: string): string {
  const hash = fnv1a(tokenId || 'token');
  const h1 = hash % 360;
  const h2 = (h1 + 40 + ((hash >>> 8) % 120)) % 360;
  const h3 = (h1 + 180 + ((hash >>> 16) % 80)) % 360;

  const bgA = hsl(h1, 72, 26);
  const bgB = hsl(h2, 74, 33);
  const stroke = hsl(h3, 52, 68);

  const shapeA = ((hash >>> 4) % 18) + 18;
  const shapeB = ((hash >>> 10) % 18) + 28;
  const eyeY = ((hash >>> 20) % 8) + 32;
  const mouthY = clamp(eyeY + 16 + ((hash >>> 23) % 8), 46, 58);
  const mouthW = ((hash >>> 26) % 20) + 20;
  const mouthX = 64 - mouthW / 2;

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="token avatar">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgA}"/>
      <stop offset="100%" stop-color="${bgB}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.18" cy="0.12" r="0.9">
      <stop offset="0%" stop-color="rgba(255,255,255,0.25)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="22" fill="url(#bg)"/>
  <rect x="8" y="8" width="112" height="112" rx="18" fill="url(#glow)"/>

  <path d="M20 ${shapeA} Q40 8 64 20 Q88 8 108 ${shapeA} L104 ${shapeB} Q84 18 64 30 Q44 18 24 ${shapeB} Z"
        fill="rgba(255,255,255,0.18)" stroke="${stroke}" stroke-width="2"/>

  <circle cx="44" cy="${eyeY}" r="7" fill="rgba(8,10,18,0.85)"/>
  <circle cx="84" cy="${eyeY}" r="7" fill="rgba(8,10,18,0.85)"/>
  <circle cx="46" cy="${eyeY - 1}" r="2.2" fill="rgba(245,248,255,0.9)"/>
  <circle cx="86" cy="${eyeY - 1}" r="2.2" fill="rgba(245,248,255,0.9)"/>

  <rect x="${mouthX}" y="${mouthY}" width="${mouthW}" height="6" rx="3" fill="rgba(8,10,18,0.7)"/>
  <path d="M30 86 Q64 104 98 86" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="3" stroke-linecap="round"/>
</svg>`.trim();

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getTokenAvatarUrl(tokenId: string): string {
  const key = tokenId || 'token';
  const cached = svgCache.get(key);
  if (cached) return cached;
  const url = buildSvg(key);
  svgCache.set(key, url);
  return url;
}
