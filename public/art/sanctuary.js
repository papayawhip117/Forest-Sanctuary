// public/art/sanctuary.js
// -----------------------------------------------------------------------------
// The Sanctuary: a pixel-art garden at night. A stone well holds a glowing
// blue flame, a mossy stone path winds up to a cozy cottage with warm
// windows, flowers dot the grass, fireflies drift about, and a bunny sleeps
// by the path.
//
// How it's built:
//   1. paintScene() draws everything that never moves ONCE, onto a hidden
//      canvas called `still`. It runs again only when the window is resized.
//   2. drawFrame() runs ~12 times a second. It copies `still` onto the real
//      canvas and adds the moving things on top: the flame, the glows, the
//      fireflies, the sparks and the bunny breathing.
//
// The scene adapts to the screen: on a tall phone the trees get taller; on a
// wide monitor the garden spreads out. Positions are worked out from the art
// size (W x H) in layOut(), so that's the place to move things around.
// -----------------------------------------------------------------------------
import {
  makeRandom, rect, px, ellipse, blob, glow, sprite, fitToScreen, animate,
  makeFireflies, drawFireflies,
} from './pixel.js';

// ------------------------------------------------------------- the palette ---
const C = {
  sky: ['#141c4e', '#1a2560', '#213070', '#2a3d85', '#344c9a', '#3f5bab'],
  farLeaves: ['#18205a', '#1f2a6a', '#28367c'],
  leaves: ['#121c46', '#1b2d62', '#28437e'],
  litLeaves: ['#173a4a', '#24605a', '#3f8c72'],   // leaves near the glow
  trunk: '#11122e',
  trunkLight: '#22265a',
  grass: ['#16304a', '#1d3d55', '#285468', '#357470'],
  path: ['#4b5d9a', '#5a70b0', '#6a82c4'],
  pathLight: '#8aa2dc',
  mortar: '#26325c',
  mossyMortar: '#2f6b5a',
  wellStone: ['#3e4c88', '#4a5c9c', '#5a6eb0'],
  wellRim: '#6d84c4',
  water: '#0c1434',
  wood: '#3e2a20',
  woodLight: '#5c4030',
  wallStone: ['#3a3e72', '#454a82', '#50568f'],
  slate: ['#2a3878', '#34448c', '#41539f'],
  slateLight: '#6077c0',
  vines: ['#1d4a3e', '#2c6c50', '#58a46a'],
  window: '#ffd36e',
  windowBright: '#fff3c0',
  windowFrame: '#3a2618',
  warm: '#ffb347',
  flame: ['#3a63ff', '#6fc8ff', '#f2fbff'],     // outer -> core
  flowers: ['#f6d36b', '#f6d36b', '#e88ac0', '#dfe8ff', '#e25b5b', '#9fd0ff'],
  foreground: ['#090d28', '#0f1640', '#18225a'],
};

// --------------------------------------------------------------- the bunny ---
// A sleeping bunny, drawn as text (see sprite() in pixel.js). It faces left,
// curled up like a loaf, with its ear lying flat along its back.
// Edit the letters to change the drawing; the palette says what each means.
const BUNNY = [
  '...oooo.............',
  '..owwwwoooooooo.....',
  '.owwwwwwpppppppoo...',
  '.owwwwwoooooooooo...',
  '.owwwwwwswwwwwwwwoo.',
  'oweewwwswwwwwwwwwsso',
  'opwwwwwswwwwwwwwssto',
  '.owwwwsswwwwwwwwssto',
  '..owwoossssssssssso.',
  '...ooo.ooooooooooo..',
];
const BUNNY_COLORS = {
  o: '#2b2850', // outline
  w: '#d9d6f0', // fur
  s: '#a19dcb', // fur in shadow
  p: '#e8a3c4', // pink (inside of the ear, nose)
  e: '#2b2850', // closed eye
  t: '#f6f4ff', // fluffy tail
};
// Breathing in: the same bunny with its middle row doubled, so it's one
// pixel taller (we also draw it one pixel higher, so the feet stay put).
const BUNNY_IN = [...BUNNY.slice(0, 5), BUNNY[4], ...BUNNY.slice(5)];

// A tiny "z" that floats up from the sleeping bunny.
const ZED = ['zzzz', '..z.', '.z..', 'zzzz'];

// --------------------------------------------------------------- the layout ---
// Works out where everything goes for an art size of W x H.
function layOut(W, H) {
  const ground = H - Math.min(92, Math.round(H * 0.62)); // where the grass starts
  const well = { x: Math.max(18, Math.round(W * 0.22)), y: ground + 36 };
  const cottageW = Math.max(46, Math.min(72, Math.round(W * 0.38)));
  const cottage = {
    x: W - cottageW - Math.max(3, Math.round(W * 0.05)),
    y: ground + 22, // bottom of the walls
    w: cottageW,
  };
  // The path runs from the bottom of the screen up to a fork between the
  // well and the cottage. pathAt(y) gives its middle x and half width.
  const fork = { x: Math.round((well.x + 12 + cottage.x) / 2), y: ground + 28 };
  const start = { x: Math.round(W * 0.5), y: H + 2 };
  function pathAt(y) {
    const t = (y - fork.y) / (start.y - fork.y); // 0 at the fork, 1 at the bottom
    // A gentle S-curve between the two ends.
    const x = fork.x + (start.x - fork.x) * t + Math.sin(t * Math.PI) * -W * 0.06;
    return { x: Math.round(x), half: Math.round(4 + 6 * t) };
  }
  return { W, H, ground, well, cottage, fork, pathAt };
}

// ------------------------------------------------------------ paint helpers ---

// A "mask" remembers which pixels belong to a shape, so we can fill that
// shape with cobblestones afterwards. It's a grid of 0s and 1s.
function makeMask(W, H) {
  const bits = new Uint8Array(W * H);
  return {
    W, H, bits,
    has: (x, y) => x >= 0 && y >= 0 && x < W && y < H && bits[y * W + x] === 1,
    addEllipse(cx, cy, rx, ry) {
      for (let dy = -ry; dy <= ry; dy++) {
        const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry || 1))));
        for (let dx = -half; dx <= half; dx++) {
          const x = Math.round(cx + dx);
          const y = Math.round(cy + dy);
          if (x >= 0 && y >= 0 && x < W && y < H) bits[y * W + x] = 1;
        }
      }
    },
  };
}

// Fill a mask with cobblestones: rows of little stones of random widths with
// 1-pixel gaps of mortar between them, and the odd bit of moss in the gaps.
function cobbles(ctx, mask, shades, light, mortar, random) {
  for (let y = 0; y < mask.H; y++) {
    for (let x = 0; x < mask.W; x++) {
      if (mask.has(x, y)) px(ctx, x, y, random() < 0.12 ? C.mossyMortar : mortar);
    }
  }
  for (let y = 0; y < mask.H; y += 4) {
    let x = -Math.floor(random() * 4);
    while (x < mask.W) {
      const w = 3 + Math.floor(random() * 4);
      const shade = shades[Math.floor(random() * shades.length)];
      // Only draw stones whose middle is on the path.
      if (mask.has(x + (w >> 1), y + 1)) {
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < w - 1; sx++) {
            if (mask.has(x + sx, y + sy)) {
              px(ctx, x + sx, y + sy, sy === 0 && sx < w - 2 ? light : shade);
            }
          }
        }
      }
      x += w;
    }
  }
}

// A wall of bricks inside a rectangle.
function bricks(ctx, x0, y0, w, h, shades, mortar, random, brickH = 3) {
  rect(ctx, x0, y0, w, h, mortar);
  for (let y = y0; y < y0 + h; y += brickH) {
    let x = x0 - Math.floor(random() * 3);
    while (x < x0 + w) {
      const bw = 3 + Math.floor(random() * 3);
      const left = Math.max(x, x0);
      const right = Math.min(x + bw - 1, x0 + w);
      if (right > left) {
        rect(ctx, left, y, right - left, Math.min(brickH - 1, y0 + h - y),
          shades[Math.floor(random() * shades.length)]);
      }
      x += bw;
    }
  }
}

// ----------------------------------------------------------- paint the scene ---
function paintScene(ctx, L) {
  const { W, H, ground, well, cottage, fork, pathAt } = L;
  const random = makeRandom(42);

  // 1. Sky: horizontal bands from dark (top) to misty blue (near the ground),
  //    with a checkerboard row between bands so they blend like old games did.
  const band = Math.max(3, Math.ceil(ground / C.sky.length));
  for (let y = 0; y < ground + 10; y++) {
    const i = Math.min(C.sky.length - 1, Math.floor(y / band));
    rect(ctx, 0, y, W, 1, C.sky[i]);
    if (y % band === 0 && i > 0) {
      for (let x = y % 2; x < W; x += 2) px(ctx, x, y, C.sky[i - 1]);
    }
  }

  // 2. Far-away treetops: rows of leafy clumps, with a few gaps left open
  //    so the misty sky peeks through. More rows on taller screens.
  for (let y = 0; y < ground * 0.8; y += 12) {
    for (let x = -6 + (y % 24 ? 8 : 0); x < W + 8; x += 16) {
      if (random() < 0.25) continue; // leave a gap
      blob(ctx, x + random() * 6, y + random() * 6, 9 + random() * 5, 7 + random() * 3, C.farLeaves, random, 0.8);
    }
  }

  // 3. Big trees: trunks first, then their crowns on top.
  const trees = [0.04, 0.36, 0.6, 0.95].map((f) => Math.round(W * f));
  for (const tx of trees) {
    const w = 4 + Math.floor(random() * 4);
    rect(ctx, tx - (w >> 1), 0, w, ground + 8, C.trunk);
    rect(ctx, tx - (w >> 1), 0, 1, ground + 8, C.trunkLight);
    // Two branches reaching out.
    for (const dir of [-1, 1]) {
      const by = Math.round(ground * (0.3 + random() * 0.3));
      for (let k = 0; k < 10; k++) rect(ctx, tx + dir * k, by - k, 2, 2, C.trunk);
    }
  }
  for (const tx of trees) {
    const layers = Math.max(2, Math.round(ground / 26));
    for (let layer = 0; layer < layers; layer++) {
      const cy = Math.round((ground * 0.78 * (layer + 0.3)) / layers);
      blob(ctx, tx + (random() - 0.5) * 12, cy, 13 + random() * 8, 8 + random() * 4, C.leaves, random, 1.1);
    }
  }
  // A smaller, greener tree lit by the flame, between well and cottage.
  rect(ctx, fork.x - 1, ground - 6, 3, 14, C.trunk);
  blob(ctx, fork.x, ground - 10, 10, 8, C.litLeaves, random, 1.2);

  // Shrubs along the back edge of the garden, hiding the line where the
  // grass meets the trees.
  for (let x = -4; x < W + 4; x += 7) {
    blob(ctx, x + random() * 4, ground + 1, 5 + random() * 3, 3 + random() * 2, random() < 0.6 ? C.leaves : C.litLeaves, random);
  }

  // 4. Grass. Base color, then lighter speckles and little blades.
  rect(ctx, 0, ground, W, H - ground, C.grass[1]);
  // Patches of darker and lighter grass, then scattered little blades.
  for (let i = 0; i < (W * (H - ground)) / 120; i++) {
    const shade = random() < 0.5 ? C.grass[0] : C.grass[2];
    ellipse(ctx, random() * W, ground + random() * (H - ground), 3 + random() * 5, 1 + random() * 2, shade);
  }
  for (let i = 0; i < (W * (H - ground)) / 14; i++) {
    const x = Math.floor(random() * W);
    const y = ground + Math.floor(random() * (H - ground));
    rect(ctx, x, y - 1, 1, 2, C.grass[random() < 0.7 ? 2 : 3]);
  }

  // Warm light from the cottage door falling on the grass.
  glow(ctx, cottage.x + cottage.w / 2, cottage.y + 8, 18, C.warm, 0.05);

  // 5. Flowers, mostly in the front (lower) part of the garden.
  //    They grow in little patches of one or two colors, like real ones.
  const patches = Math.round((W * (H - ground)) / 300);
  for (let i = 0; i < patches; i++) {
    const cx = random() * W;
    const cy = ground + 4 + Math.sqrt(random()) * (H - ground - 4);
    const colors = [C.flowers[Math.floor(random() * 6)], C.flowers[Math.floor(random() * 6)]];
    for (let k = 0; k < 8; k++) {
      const x = Math.round(cx + (random() - 0.5) * 12);
      const y = Math.round(cy + (random() - 0.5) * 5);
      px(ctx, x, y + 1, C.grass[3]); // a little stem
      px(ctx, x, y, colors[k % 2]);
    }
  }

  // 6. The stone path, plus short branches to the well and the steps.
  const path = makeMask(W, H);
  for (let y = fork.y; y <= H + 2; y++) {
    const p = pathAt(y);
    path.addEllipse(p.x, y, p.half, 1);
  }
  for (let t = 0; t <= 1; t += 0.05) {
    path.addEllipse(fork.x + (well.x + 10 - fork.x) * t, fork.y + (well.y - 1 - fork.y) * t, 4, 2);
    path.addEllipse(fork.x + (cottage.x + cottage.w * 0.5 - fork.x) * t, fork.y + (cottage.y + 7 - fork.y) * t, 4, 2);
  }
  path.addEllipse(well.x, well.y + 1, 16, 4); // the well's round platform
  cobbles(ctx, path, C.path, C.pathLight, C.mortar, random);

  paintWell(ctx, well, random);
  paintCottage(ctx, cottage, random);

  // 7. Bushes around the garden, some with flowers.
  const bushes = [
    [well.x - 21, well.y - 4, 6, 5], [cottage.x - 4, cottage.y + 2, 6, 4],
    [cottage.x + cottage.w + 2, cottage.y, 6, 7], [fork.x + 2, ground + 6, 5, 4],
  ];
  for (const [x, y, rx, ry] of bushes) {
    blob(ctx, x, y, rx, ry, C.litLeaves, random, 1.3);
    for (let i = 0; i < 4; i++) {
      px(ctx, x + (random() - 0.5) * rx * 1.6, y + (random() - 0.5) * ry * 1.4, C.flowers[i % 3]);
    }
  }

  // 8. Dark leaves framing the edges, nearest to us.
  blob(ctx, 0, H, 14, 10, C.foreground, random, 1.2);
  blob(ctx, W, H - 2, 12, 12, C.foreground, random, 1.2);
  for (let x = -6; x < W + 6; x += 12) {
    blob(ctx, x, -2, 9, 5 + random() * 4, C.foreground, random);
  }
}

// ---------------------------------------------------------------- the well ---
// (x, y) is the bottom middle of the well's round wall.
function paintWell(ctx, { x, y }, random) {
  // Wooden posts and a crossbeam behind the well.
  rect(ctx, x - 12, y - 28, 2, 26, C.wood);
  rect(ctx, x + 10, y - 28, 2, 26, C.wood);
  rect(ctx, x - 12, y - 28, 1, 26, C.woodLight);
  rect(ctx, x - 14, y - 30, 28, 2, C.woodLight);
  // The round wall: bricks, darker on the right side (away from the light).
  bricks(ctx, x - 11, y - 11, 23, 12, C.wellStone, C.mortar, random);
  rect(ctx, x + 7, y - 11, 5, 12, 'rgba(10, 12, 40, 0.35)');
  // The rim, and dark water inside with a few blue glints.
  ellipse(ctx, x, y - 11, 12, 3, C.wellRim);
  ellipse(ctx, x, y - 11, 9, 2, C.water);
  px(ctx, x - 4, y - 11, '#5fb8ff');
  px(ctx, x + 3, y - 12, '#5fb8ff');
  // A stone pillar in the middle with a little bowl holding the flame.
  rect(ctx, x - 2, y - 21, 4, 10, C.wellStone[2]);
  rect(ctx, x - 2, y - 21, 1, 10, C.wellRim);
  rect(ctx, x - 4, y - 23, 9, 2, C.wellRim);
  // Moss and ivy creeping up the well.
  for (let i = 0; i < 10; i++) px(ctx, x - 11 + Math.floor(random() * 23), y - Math.floor(random() * 4), C.vines[1 + (i % 2)]);
}

// ------------------------------------------------------------- the cottage ---
// (x, y) is the bottom left corner of the walls; w is the width.
function paintCottage(ctx, { x, y, w }, random) {
  const wallH = 20;
  const top = y - wallH;
  const roofH = Math.round(w * 0.42);

  // Stone walls with a wooden frame.
  bricks(ctx, x, top, w, wallH, C.wallStone, '#24264e', random);
  for (const fx of [x, x + Math.round(w / 2) - 1, x + w - 2]) rect(ctx, fx, top, 2, wallH, C.wood);
  rect(ctx, x, top, w, 2, C.wood);

  // Door (open a crack, warm light inside) and two glowing windows.
  const door = cottageDoor({ x, y, w });
  rect(ctx, door.x - 1, door.y - 1, 9, 14, C.windowFrame);
  rect(ctx, door.x, door.y, 7, 13, '#e8a24a');
  rect(ctx, door.x, door.y + 7, 7, 6, '#c0782e');
  rect(ctx, door.x, door.y, 3, 13, '#5a3a22'); // the door itself, swung open
  for (const win of cottageWindows({ x, y, w })) {
    rect(ctx, win.x - 1, win.y - 1, 9, 8, C.windowFrame);
    rect(ctx, win.x, win.y, 7, 6, C.window);
    rect(ctx, win.x + 3, win.y, 1, 6, '#a0602a');   // window bars
    rect(ctx, win.x, win.y + 2, 7, 1, '#a0602a');
    rect(ctx, win.x, win.y, 2, 1, C.windowBright);
    rect(ctx, win.x - 1, win.y + 7, 9, 1, '#c98a3a'); // sill
  }
  // A lantern hanging beside the door.
  rect(ctx, door.x + 9, door.y - 1, 3, 1, C.wood);
  rect(ctx, door.x + 10, door.y, 2, 3, C.window);

  // Slate roof: wider at the bottom, tiles in staggered rows.
  for (let r = 0; r < roofH; r++) {
    const t = r / (roofH - 1);
    const rowW = Math.round(w * 0.5 + (w + 8 - w * 0.5) * t);
    const left = x + Math.round((w - rowW) / 2);
    for (let i = 0; i < rowW; i++) {
      const tile = Math.floor((i + (Math.floor(r / 2) % 2) * 2) / 3);
      let color = C.slate[(tile * 7 + Math.floor(r / 2) * 3) % 3];
      if (r % 2 === 1 && (i + (Math.floor(r / 2) % 2) * 2) % 3 === 0) color = '#1f2858';
      if (r < 2 || i === 0) color = C.slateLight; // ridge and left edge catch moonlight
      px(ctx, left + i, top - roofH + r, color);
    }
  }
  rect(ctx, x - 4, top, w + 8, 1, '#1a2050'); // shadow under the eaves

  // Vines growing over the roof, hanging down in strands.
  for (let i = 0; i < 5; i++) {
    blob(ctx, x - 2 + random() * w * 0.45, top - 2 - roofH * random() * 0.7, 2 + random() * 2, 1 + random() * 2, C.vines, random, 0.7);
  }
  for (let i = 0; i < 7; i++) {
    const vx = Math.round(x - 3 + random() * (w + 6));
    const len = 2 + Math.floor(random() * 7);
    for (let k = 0; k < len; k++) px(ctx, vx, top + 1 + k, k % 3 === 2 ? C.vines[2] : C.vines[1]);
  }

  // Stone steps up to the door, and a low mossy wall to their left.
  for (let s = 0; s < 3; s++) {
    const sw = 11 + s * 2;
    rect(ctx, door.x + 3 - (sw >> 1), y + s * 2, sw, 2, C.path[2 - s]);
    rect(ctx, door.x + 3 - (sw >> 1), y + s * 2, sw, 1, C.pathLight);
  }
  const wallRight = door.x - 6;
  if (wallRight - x > 4) {
    bricks(ctx, x - 6, y - 1, wallRight - x + 6, 6, C.path, C.mortar, random);
    for (let i = x - 6; i < wallRight; i++) {
      if (random() < 0.7) px(ctx, i, y - 2, C.vines[1 + Math.floor(random() * 2)]);
    }
  }
}

// Where the cottage's door and windows are (used for painting AND for the
// animated glows, so they always line up).
function cottageDoor({ x, y, w }) {
  return { x: x + Math.round(w * 0.5) - 3 + 4, y: y - 13 };
}
function cottageWindows({ x, y, w }) {
  const wy = y - 20 + 5;
  return [{ x: x + Math.round(w * 0.12) + 1, y: wy }, { x: x + w - Math.round(w * 0.12) - 9, y: wy }];
}

// Where the bunny sleeps: on the grass just right of the path, near the front.
function bunnySpot(L) {
  const y = L.H - Math.max(16, Math.round((L.H - L.ground) * 0.25));
  const p = L.pathAt(y);
  return { x: Math.min(L.W - 23, p.x + p.half + 3), y };
}

// ------------------------------------------------------------ moving parts ---
function drawFlame(ctx, { x, y }, t) {
  const base = y - 24;
  // The flame's height flickers between about 9 and 13 pixels.
  const h = 11 + Math.round(Math.sin(t * 9) + Math.sin(t * 13.7) * 0.8);
  const sway = Math.round(Math.sin(t * 5) * 1.2);
  // A big soft glow, gently pulsing.
  glow(ctx, x, base - 5, 28, '#2a5cff', 0.05 + Math.sin(t * 2) * 0.01);
  glow(ctx, x, base - 5, 12, '#7fd0ff', 0.06);
  // The flame is a teardrop, painted one row at a time from the tip down.
  // Each row's half-width follows a curve that is thin at the top, widest
  // near the bottom and round underneath. The tip sways, the base doesn't.
  for (let row = 0; row < h; row++) {
    const f = row / (h - 1); // 0 at the tip, 1 at the bottom
    const half = Math.round(3.5 * Math.sin(Math.PI * Math.pow(f, 1.6)));
    const cx = x + Math.round(sway * (1 - f));
    const y = base - h + row;
    rect(ctx, cx - half, y, half * 2 + 1, 1, C.flame[0]);
    if (half > 1) rect(ctx, cx - half + 1, y, half * 2 - 1, 1, C.flame[1]);
    if (half > 2 && f > 0.45) rect(ctx, cx - 1, y, 3, 1, C.flame[2]);
  }
  // Blue sparks drifting up and fading away.
  for (let i = 0; i < 6; i++) {
    const life = (t * 0.35 + i / 6) % 1; // 0 -> 1, then starts again
    const sx = Math.round(x + Math.sin(life * 6 + i * 2) * (3 + i));
    const sy = Math.round(base - h - life * 28);
    ctx.globalAlpha = 1 - life;
    px(ctx, sx, sy, '#bfe8ff');
    ctx.globalAlpha = 1;
  }
}

function drawCottageLights(ctx, cottage, t) {
  const flicker = 0.07 + Math.sin(t * 3) * 0.008 + Math.sin(t * 7.3) * 0.006;
  for (const win of cottageWindows(cottage)) glow(ctx, win.x + 3, win.y + 3, 11, C.warm, flicker);
  const door = cottageDoor(cottage);
  glow(ctx, door.x + 3, door.y + 7, 12, C.warm, flicker);
  glow(ctx, door.x + 11, door.y + 1, 5, C.window, flicker * 1.4);
}

function drawBunny(ctx, spot, t) {
  // One slow breath every ~3 seconds: in for half, out for half.
  const breathingIn = Math.sin(t * 2) > 0;
  ellipse(ctx, spot.x + 10, spot.y + 9, 10, 1, 'rgba(5, 8, 25, 0.5)'); // shadow
  sprite(ctx, spot.x, spot.y - (breathingIn ? 1 : 0), breathingIn ? BUNNY_IN : BUNNY, BUNNY_COLORS);
  // A "z" floats up from its head every few seconds.
  const life = (t / 3.5) % 1;
  ctx.globalAlpha = Math.max(0, 1 - life) * 0.85;
  sprite(ctx, spot.x + 3 + Math.round(life * 3), spot.y - 6 - Math.round(life * 10), ZED, { z: '#cfe0ff' });
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ start ---
const canvas = document.getElementById('sanctuary-art');
const ctx = canvas.getContext('2d');
let still, layout, flies, bunny;

function setUp() {
  const { width, height } = fitToScreen(canvas, 110);
  layout = layOut(width, height);
  still = document.createElement('canvas');
  still.width = width;
  still.height = height;
  paintScene(still.getContext('2d'), layout);
  bunny = bunnySpot(layout);
  flies = makeFireflies(
    Math.max(8, Math.min(40, Math.round((width * height) / 900))),
    { x: 0, y: layout.ground - 40, w: width, h: height - layout.ground + 30 },
    makeRandom(9),
  );
}

setUp();
window.addEventListener('resize', setUp);
animate((t) => {
  ctx.drawImage(still, 0, 0);
  drawCottageLights(ctx, layout.cottage, t);
  drawFlame(ctx, layout.well, t);
  drawBunny(ctx, bunny, t);
  drawFireflies(ctx, flies, t);
});
