// Generates media/icon.svg and media/icon.png: an abstract woven ring, no people, no text.
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const size = 256;
const c = size / 2;
const threads = [];
for (let i = 0; i < 5; i++) {
  const y = 78 + i * 25;
  threads.push(`<line x1="58" y1="${y}" x2="198" y2="${y}" stroke="#e8f1ef" stroke-opacity="${0.35 + i * 0.1}" stroke-width="9" stroke-linecap="round"/>`);
}
const r = 92;
const circumference = 2 * Math.PI * r;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1f5f5b"/>
      <stop offset="1" stop-color="#173a4a"/>
    </linearGradient>
    <clipPath id="inner"><circle cx="${c}" cy="${c}" r="70"/></clipPath>
  </defs>
  <rect width="${size}" height="${size}" rx="52" fill="url(#bg)"/>
  <g clip-path="url(#inner)">${threads.join('')}</g>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#2c7f78" stroke-width="16"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f2b84b" stroke-width="16" stroke-linecap="round"
    stroke-dasharray="${(circumference * 0.68).toFixed(1)} ${circumference.toFixed(1)}" transform="rotate(-90 ${c} ${c})"/>
</svg>
`;
writeFileSync('media/icon.svg', svg);
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 256 } }).render().asPng();
writeFileSync('media/icon.png', png);
console.log('icon written', png.length, 'bytes');
