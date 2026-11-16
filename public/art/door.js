// public/art/door.js
// -----------------------------------------------------------------------------
// The login page art: an old wooden door, overgrown with vines and moss, set
// in a mossy stone wall at night. The login form is plain HTML placed on top
// of the door by CSS (see .door-form in styles.css). This script only paints.
//
// Two canvases:
//   #door-art  - the door itself, always 72 x 108 art-pixels (a 2:3 shape).
//                CSS sizes it, so the form can sit on it at fixed % positions.
//   #wall-art  - the wall behind, sized to the screen, with fireflies.
// -----------------------------------------------------------------------------
import {
  makeRandom, rect, px, ellipse, blob, fitToScreen, animate,
  makeFireflies, drawFireflies,
} from './pixel.js';

// The palette. Change a color here and it changes everywhere it's used.
const C = {
  night: '#0b0f2a',
  stone: ['#3b3f5e', '#555a7c', '#686e92', '#7f86a8'], // arch, dark -> light
  mortar: '#23263f',
  wall: ['#14182f', '#191e3a', '#1e2444'],              // the dim wall behind
  wallMortar: '#0c0f22',
  ivy: ['#10262a', '#183d36', '#285f45'],
  wood: ['#3a2416', '#55351f', '#6b4428', '#80553a'],   // dark -> light
  iron: '#24222e',
  rivet: '#7a7890',
  leaves: ['#1d4433', '#2f6b45', '#5aa35a'],             // dark, mid, light
  moss: ['#2a4a2e', '#3f6e3a', '#6da64f'],
  flowers: ['#f6d36b', '#e88ac0', '#dfe8ff'],
};

// ---------------------------------------------------------------- the door ---
const DOOR_W = 72;
const DOOR_H = 108;
const CX = 36;       // middle of the door
const ARCH_Y = 36;   // where the round top of the arch is centered
const OUTER_R = 34;  // stone arch, outside edge
const INNER_R = 27;  // wooden door, edge

// Is (x, y) inside an arch shape (half circle on top of a rectangle)?
function inArch(x, y, r) {
  if (Math.abs(x + 0.5 - CX) > r) return false;
  if (y >= ARCH_Y) return true;
  const dx = x + 0.5 - CX;
  const dy = y + 0.5 - ARCH_Y;
  return dx * dx + dy * dy <= r * r;
}

function paintDoor(ctx) {
  const random = makeRandom(7);

  // 1. Stone arch: blocks of random stone shades with dark mortar lines.
  for (let y = 0; y < DOOR_H; y++) {
    for (let x = 0; x < DOOR_W; x++) {
      if (!inArch(x, y, OUTER_R) || inArch(x, y, INNER_R)) continue;
      // Split the arch into blocks: rows 5 tall, staggered like bricks.
      const row = Math.floor(y / 5);
      const col = Math.floor((x + (row % 2) * 3) / 6);
      const isMortar = y % 5 === 0 || (x + (row % 2) * 3) % 6 === 0;
      // Darker toward the outside edge of the arch, lighter near the door.
      const fromCenter = Math.hypot(x + 0.5 - CX, Math.min(0, y - ARCH_Y));
      const outer = y >= ARCH_Y ? Math.abs(x + 0.5 - CX) : fromCenter;
      const base = outer > OUTER_R - 2 ? 0 : 1 + ((row * 7 + col * 13) % 3);
      px(ctx, x, y, isMortar ? C.mortar : C.stone[base]);
    }
  }

  // 2. Wooden planks inside the arch. 7 vertical planks, 8 pixels wide.
  const left = CX - INNER_R;
  for (let y = 0; y < DOOR_H; y++) {
    for (let x = left; x < CX + INNER_R; x++) {
      if (!inArch(x, y, INNER_R)) continue;
      const plank = Math.floor((x - left) / 8);
      const edge = (x - left) % 8;
      let color = C.wood[1 + (plank % 2)];
      if (edge === 0) color = C.wood[0];          // dark gap between planks
      else if (edge === 1) color = C.wood[3];     // light edge catching light
      px(ctx, x, y, color);
    }
  }
  // Wood grain: short dark streaks and a few knots.
  for (let i = 0; i < 70; i++) {
    const x = left + 2 + Math.floor(random() * (INNER_R * 2 - 3));
    const y = Math.floor(random() * DOOR_H);
    const len = 2 + Math.floor(random() * 4);
    for (let k = 0; k < len; k++) {
      if (inArch(x, y + k, INNER_R) && (x - left) % 8 > 1) px(ctx, x, y + k, C.wood[0]);
    }
  }

  // 3. Iron bands with rivets: one up in the arch, one near the bottom.
  for (const bandY of [20, 99]) {
    for (let x = left; x < CX + INNER_R; x++) {
      if (!inArch(x, bandY, INNER_R)) continue;
      rect(ctx, x, bandY, 1, 3, C.iron);
      if ((x - left) % 8 === 4) px(ctx, x, bandY + 1, C.rivet);
    }
  }

  // 4. Overgrowth. Leafy clumps in the top corners and over the arch...
  // (Kept a few pixels away from the canvas edges, so no leaf gets cut
  // off in a straight line.)
  blob(ctx, 10, 12, 6, 8, C.leaves, random, 1.4);
  blob(ctx, 62, 13, 6, 9, C.leaves, random, 1.4);
  blob(ctx, 22, 7, 9, 3, C.leaves, random);
  blob(ctx, 50, 8, 9, 3, C.leaves, random);
  blob(ctx, 36, 5, 7, 2, C.leaves, random);

  // ...vines hanging down the stone frame, with leaves on alternate sides...
  const vines = [
    { x: 4, top: 10, len: 70 }, { x: 8, top: 14, len: 40 },
    { x: 67, top: 12, len: 80 }, { x: 63, top: 14, len: 36 },
    { x: 14, top: 6, len: 18 }, { x: 58, top: 6, len: 22 },
  ];
  for (const v of vines) {
    let x = v.x;
    for (let y = v.top; y < v.top + v.len && y < DOOR_H; y++) {
      if (random() < 0.15) x += random() < 0.5 ? -1 : 1; // wiggle
      px(ctx, x, y, C.leaves[0]);
      if (y % 4 === 0) {
        const side = (y / 4) % 2 ? 1 : -1;
        px(ctx, x + side, y, C.leaves[1]);
        px(ctx, x + side * 2, y - 1, C.leaves[2]);
        px(ctx, x + side, y - 1, C.leaves[1]);
      }
    }
  }

  // ...moss on the arch stones and creeping up the bottom of the door...
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(random() * DOOR_W);
    const y = DOOR_H - 2 - Math.floor(Math.pow(random(), 2) * 12);
    blob(ctx, x, y, 2 + random() * 3, 1 + random() * 2, C.moss, random, 0.6);
  }
  blob(ctx, 3, 102, 7, 6, C.moss, random, 1.5);
  blob(ctx, 69, 100, 7, 8, C.moss, random, 1.5);
  blob(ctx, 22, 107, 10, 3, C.moss, random);
  blob(ctx, 50, 107, 10, 3, C.moss, random);

  // ...and a few tiny flowers in the moss.
  for (let i = 0; i < 9; i++) {
    const x = 2 + Math.floor(random() * (DOOR_W - 4));
    const y = DOOR_H - 2 - Math.floor(random() * 5);
    px(ctx, x, y, C.flowers[i % 3]);
  }
}

// ---------------------------------------------------------------- the wall ---
// The screen-sized background: a mossy stone wall, grass at the bottom, ivy.
function paintWall(ctx, w, h) {
  const random = makeRandom(21);
  rect(ctx, 0, 0, w, h, C.night);

  // Stone blocks, 4 tall and 7 wide, staggered. Darker toward the top.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const row = Math.floor(y / 4);
      const off = (row % 2) * 4;
      const isMortar = y % 4 === 0 || (x + off) % 7 === 0;
      const shade = (row * 5 + Math.floor((x + off) / 7) * 3) % 3;
      px(ctx, x, y, isMortar ? C.wallMortar : C.wall[shade]);
    }
  }

  // Ivy clumps all over the wall, and darker foliage around the edges.
  for (let i = 0; i < (w * h) / 450; i++) {
    blob(ctx, random() * w, random() * h * 0.9, 3 + random() * 6, 3 + random() * 5, C.ivy, random);
  }
  for (let x = -6; x < w + 6; x += 9) {
    blob(ctx, x, -2, 8, 6, ['#0d1a24', '#13283a', '#1d3a4a'], random);
  }

  // Grass along the bottom with flowers.
  const ground = h - Math.round(h * 0.1);
  rect(ctx, 0, ground, w, h - ground, C.moss[0]);
  for (let x = 0; x < w; x++) {
    const tuft = Math.floor(random() * 3);
    rect(ctx, x, ground - tuft, 1, tuft, C.moss[1]);
    if (random() < 0.3) px(ctx, x, ground - tuft, C.moss[2]);
    if (random() < 0.06) px(ctx, x, ground + 1 + Math.floor(random() * (h - ground - 2)), C.flowers[Math.floor(random() * 3)]);
  }
}

// ------------------------------------------------------------------ start ---
const doorCanvas = document.getElementById('door-art');
doorCanvas.width = DOOR_W;
doorCanvas.height = DOOR_H;
paintDoor(doorCanvas.getContext('2d'));

const wallCanvas = document.getElementById('wall-art');
const wallCtx = wallCanvas.getContext('2d');
let still;     // a copy of the painted wall, so each frame only adds fireflies
let flies = [];

function setUpWall() {
  const { width, height } = fitToScreen(wallCanvas, 110);
  still = document.createElement('canvas');
  still.width = width;
  still.height = height;
  paintWall(still.getContext('2d'), width, height);
  flies = makeFireflies(Math.round((width * height) / 500), { x: 0, y: 0, w: width, h: height }, makeRandom(5));
}

setUpWall();
window.addEventListener('resize', setUpWall);
animate((t) => {
  wallCtx.drawImage(still, 0, 0);
  drawFireflies(wallCtx, flies, t);
});
