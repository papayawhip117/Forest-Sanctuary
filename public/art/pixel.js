// public/art/pixel.js
// -----------------------------------------------------------------------------
// Tiny pixel-art toolkit shared by the door (login) and the sanctuary scenes.
//
// The trick behind all the art on this site:
//   1. Draw on a SMALL <canvas>, e.g. 72 x 108 pixels. Every drawing call
//      below uses whole-number coordinates, so each call colors whole pixels.
//   2. Let CSS stretch that canvas to fill the screen, with
//      `image-rendering: pixelated` (see styles.css). The browser then makes
//      each canvas pixel a crisp square block instead of blurring it.
// So "1 pixel" in these files means one chunky block on screen.
//
// This file is an ES module: the scene files load it with
//   import { rect, blob, ... } from './pixel.js';
// -----------------------------------------------------------------------------

// A seeded random number generator ("mulberry32"). Math.random() gives
// different numbers on every page load; this gives the SAME sequence for the
// same seed, so the forest looks identical every visit. Change a seed in a
// scene file to get a different (but stable) arrangement of leaves/flowers.
export function makeRandom(seed) {
  return function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A filled rectangle. `| 0` rounds down to a whole pixel.
export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
}

// One pixel.
export function px(ctx, x, y, color) {
  rect(ctx, x, y, 1, 1, color);
}

// A filled ellipse, drawn one row at a time so the edges stay blocky.
export function ellipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry || 1))));
    ctx.fillRect((cx - half) | 0, (cy + dy) | 0, half * 2 + 1, 1);
  }
}

// A leafy clump, like a bush or a tree's crown. It is many small round
// "puffs" scattered inside an ellipse. Each puff is painted in three shades:
// a dark base, a mid tone shifted up-left, and a few light pixels on top.
// That fakes moonlight shining from above. `shades` = [dark, mid, light].
export function blob(ctx, cx, cy, rx, ry, shades, random, density = 1) {
  const [dark, mid, light] = shades;
  const count = Math.max(3, Math.round(((rx * ry) / 9) * density));
  const puffs = [];
  for (let i = 0; i < count; i++) {
    // Pick a random point inside the ellipse.
    const angle = random() * Math.PI * 2;
    const dist = Math.sqrt(random());
    puffs.push({
      x: cx + Math.cos(angle) * rx * dist,
      y: cy + Math.sin(angle) * ry * dist,
      r: 2 + random() * 3,
    });
  }
  // Paint the higher puffs first, so lower ones overlap them (feels deeper).
  puffs.sort((a, b) => a.y - b.y);
  for (const p of puffs) {
    const r = Math.round(p.r);
    ellipse(ctx, p.x, p.y, r, r, dark);
    ellipse(ctx, p.x - 1, p.y - 1, Math.max(1, r - 1), Math.max(1, r - 1), mid);
    if (light && r > 1) {
      px(ctx, p.x - 1, p.y - r + 1, light);
      px(ctx, p.x, p.y - r + 1, light);
      if (random() < 0.5) px(ctx, p.x - 2, p.y - r + 2, light);
    }
  }
}

// A soft round glow (a lamp, a flame). It stacks see-through circles, each
// smaller and brighter, using the 'lighter' blend mode so colors ADD up like
// real light. With the canvas scaled up this gives stepped, pixel-art rings.
export function glow(ctx, cx, cy, radius, color, strength = 0.12) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = strength;
  for (let r = radius; r >= 1; r -= Math.max(1, Math.round(radius / 6))) {
    ellipse(ctx, cx, cy, r, r, color);
  }
  ctx.restore();
}

// Draw a little picture written as text. Each string is one row of pixels,
// each letter is looked up in `palette` to get its color, and '.' means
// "leave this pixel empty". It's the easiest way to hand-draw small things:
// see the bunny in sanctuary.js.
export function sprite(ctx, x, y, rows, palette) {
  rows.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      if (ch !== '.' && palette[ch]) px(ctx, x + dx, y + dy, palette[ch]);
    });
  });
}

// Make a canvas match the screen, in chunky pixels. `shortSide` is roughly
// how many art-pixels fit across the screen's shorter edge, so a phone and a
// big monitor both get blocks of a pleasant size. Returns the art size.
export function fitToScreen(canvas, shortSide) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const block = Math.max(2, Math.round(Math.min(w, h) / shortSide));
  canvas.width = Math.ceil(w / block);
  canvas.height = Math.ceil(h / block);
  return { width: canvas.width, height: canvas.height };
}

// Run `drawFrame(seconds)` about 12 times a second. A low frame rate looks
// more like an old game and costs almost no battery. If the visitor has
// asked their device for reduced motion, we draw one still frame instead.
export function animate(drawFrame) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) {
    drawFrame(0);
    return;
  }
  let last = 0;
  function tick(ms) {
    if (ms - last > 1000 / 12) {
      last = ms;
      drawFrame(ms / 1000);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// Fireflies: little yellow-green dots that wander in loops and pulse.
// makeFireflies() picks where they live (once); drawFireflies() draws them
// at a moment in time `t` (in seconds).
export function makeFireflies(count, area, random) {
  return Array.from({ length: count }, () => ({
    x: area.x + random() * area.w,
    y: area.y + random() * area.h,
    phase: random() * Math.PI * 2,
    speed: 0.3 + random() * 0.5,
  }));
}

export function drawFireflies(ctx, flies, t) {
  for (const f of flies) {
    const x = Math.round(f.x + Math.sin(t * f.speed + f.phase) * 5);
    const y = Math.round(f.y + Math.cos(t * f.speed * 1.3 + f.phase) * 3);
    // Blink: brightness swings between 0 and 1 (and stays dark a while).
    const bright = Math.max(0, Math.sin(t * 1.7 + f.phase * 3));
    if (bright < 0.15) continue;
    glow(ctx, x, y, 3, '#d8ff7a', 0.08 * bright);
    ctx.globalAlpha = bright;
    px(ctx, x, y, '#f4ffb0');
    ctx.globalAlpha = 1;
  }
}
