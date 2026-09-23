/**
 * Generates the PWA/app icons for dblearn from a single SVG source using
 * sharp (a Next.js dependency). Renders PNGs into public/icons/:
 *   icon-192.png, icon-512.png        (purpose: any — rounded square)
 *   icon-maskable-512.png             (purpose: maskable — full-bleed bg)
 *   apple-touch-icon.png              (180, no alpha)
 *   icon.svg                          (vector favicon / manifest svg)
 *
 * Run: node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SIZE = 512;
const BG = "#0a0a0a"; // zinc-950
const EMERALD = "#10b981";
const EMERALD_LIGHT = "#34d399";

/**
 * Database-ish mark: a cylinder (two ellipses + body) with a small
 * key/pointer glint. Drawn in a 512x512 viewBox coordinate space.
 */
function mark(sx = 0, sy = 0, s = 1) {
  const cx = 256 * s + sx;
  const topY = 180 * s + sy;
  const bodyY = 368 * s + sy;
  const rx = 132 * s;
  const ry = 52 * s;
  const body = bodyY - topY;
  return `
    <g>
      <path d="M ${cx - rx} ${topY + ry} L ${cx - rx} ${topY + ry + body} A ${rx} ${ry} 0 0 0 ${cx + rx} ${topY + ry + body} L ${cx + rx} ${topY + ry} A ${rx} ${ry} 0 0 1 ${cx - rx} ${topY + ry} Z" fill="${EMERALD}"/>
      <ellipse cx="${cx}" cy="${topY + ry}" rx="${rx}" ry="${ry}" fill="${EMERALD}" stroke="${EMERALD}"/>
      <ellipse cx="${cx}" cy="${topY}" rx="${rx}" ry="${ry}" fill="${EMERALD_LIGHT}"/>
      <ellipse cx="${cx}" cy="${topY}" rx="${rx}" ry="${ry}" fill="rgba(255,255,255,0.14)"/>
      <path d="M ${cx - rx * 0.62} ${topY - ry * 0.1} h ${rx * 1.24}" stroke="rgba(0,0,0,0.20)" stroke-width="${10 * s}" stroke-linecap="round"/>
      <ellipse cx="${cx}" cy="${topY + ry}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="${7 * s}"/>
    </g>
  `;
}

/** Rounded-square "any" icon; content is centered and safe. */
function anyIconSvg() {
  const pad = 26;
  return svgFrame(`
    <rect x="${pad}" y="${pad}" width="${SIZE - pad * 2}" height="${SIZE - pad * 2}" rx="112" fill="${BG}"/>
    ${mark()}
  `);
}

/** Full-bleed maskable icon; visual content kept inside the safe zone. */
function maskableIconSvg() {
  const s = 0.84;
  const cx = (SIZE - SIZE * s) / 2;
  const cy = (SIZE - SIZE * s) / 2;
  return svgFrame(`<rect width="${SIZE}" height="${SIZE}" fill="${BG}"/>${mark(cx, cy, s)}`);
}

function svgFrame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    ${inner}
  </svg>`;
}

const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const anySvg = anyIconSvg();
const maskSvg = maskableIconSvg();

writeFileSync(join(outDir, "icon.svg"), anySvg);
console.log("wrote icon.svg");

// any icons
for (const size of [192, 512]) {
  const png = await sharp(Buffer.from(anySvg))
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png`);
}

// maskable
const maskPng = await sharp(Buffer.from(maskSvg))
  .resize(512, 512)
  .png()
  .toBuffer();
writeFileSync(join(outDir, "icon-maskable-512.png"), maskPng);
console.log("wrote icon-maskable-512.png");

// apple touch (flat, no transparency for iOS)
const applePng = await sharp(Buffer.from(anySvg))
  .resize(180, 180)
  .flatten({ background: BG })
  .png()
  .toBuffer();
writeFileSync(join(outDir, "apple-touch-icon.png"), applePng);
console.log("wrote apple-touch-icon.png");

console.log("done");