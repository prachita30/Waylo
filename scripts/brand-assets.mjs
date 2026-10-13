// Regenerates raster brand assets (app icons, social image) from the WAYLO SVG sources.
// Usage: node scripts/brand-assets.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const pub = path.resolve('apps/web/public');
const mark = readFileSync(path.join(pub, 'favicon.svg'), 'utf8');
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

function png(svg, width, out) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' },
  });
  writeFileSync(path.join(pub, out), r.render().asPng());
  console.log('wrote', out);
}

png(mark, 192, 'icon-192.png');
png(mark, 512, 'icon-512.png');
png(mark, 180, 'apple-touch-icon.png');

// Maskable icon: full-bleed midnight background with the mark inside the 80% safe zone.
png(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0E1A2B"/><g transform="translate(9.6 9.6) scale(0.7)">${inner}</g></svg>`,
  512,
  'icon-512-maskable.png',
);

// Social sharing image (1200×630).
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ECE9FB"/><stop offset="1" stop-color="#E5F1FB"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="#FAF7F2"/>
  <rect x="700" y="0" width="500" height="630" fill="url(#sky)"/>
  <path d="M760 470 Q 930 140 1130 210" stroke="#0E1A2B" stroke-opacity="0.5" stroke-width="4" stroke-dasharray="4 14" stroke-linecap="round" fill="none"/>
  <circle cx="760" cy="470" r="12" fill="#0E1A2B"/>
  <circle cx="1130" cy="210" r="14" fill="#13A88A"/>
  <rect x="728" y="500" width="92" height="40" rx="10" fill="#0E1A2B"/>
  <text x="774" y="528" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="22" fill="#FAF7F2" letter-spacing="2">BOM</text>
  <rect x="1084" y="236" width="92" height="40" rx="10" fill="#13A88A"/>
  <text x="1130" y="264" text-anchor="middle" font-family="Consolas, monospace" font-weight="700" font-size="22" fill="#FFFFFF" letter-spacing="2">GOI</text>
  <g transform="translate(80 80) scale(1.25)">${inner}</g>
  <text x="180" y="140" font-family="Segoe UI" font-weight="800" font-size="52" fill="#0E1A2B" letter-spacing="-2">WAYLO</text>
  <text x="80" y="330" font-family="Segoe UI" font-weight="700" font-size="76" fill="#0E1A2B" letter-spacing="-3">Your next journey,</text>
  <text x="80" y="420" font-family="Segoe UI" font-weight="700" font-size="76" fill="#2648E8" letter-spacing="-3">for less.</text>
  <text x="80" y="510" font-family="Segoe UI" font-weight="500" font-size="30" fill="#4A5568">Flight offers and shared airport rides.</text>
</svg>`;
png(og, 1200, 'og-image.png');
