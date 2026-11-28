// Automated checks for browser-side logic that needs no browser:
// src/board-client.js helpers and the triple-click guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightTint, wrapCopies, unwrapX, opBounds, exportFilename,
  describeSize, presetFor, BOARD_SIZES, isWrapBoard, describeWrapSize, normalizeRoom, SIZE_LIMITS
} from '../src/board-client.js';
import { createTileStore, tileRanges, tilesTouched, exportSize, MAX_CANVAS_PIXELS } from '../src/tile-store.js';
import { createMultiClick } from '../src/triple-click.js';

test('C-01 highlight tint is the colour mixed 50% with the background', () => {
  assert.equal(highlightTint('#FFFF00', '#FFFFFF'), 'rgb(255,255,128)');
  assert.equal(highlightTint('#000', '#FFFFFF'), 'rgb(128,128,128)', '3-digit hex');
  assert.equal(highlightTint('nonsense', '#FFFFFF'), highlightTint('#FFEB3B', '#FFFFFF'), 'bad colour falls back to yellow');
});

test('C-02 360 boards: strokes near the join are drawn on both edges', () => {
  assert.deepEqual(wrapCopies(10, 20, 0), [0], 'flat board: once');
  assert.deepEqual(wrapCopies(7990, 8010, 8000).map((n) => n + 0), [-8000, 0, 8000]);
  assert.deepEqual(wrapCopies(-20, 10, 8000), [0, 8000, 16000]);
});

test('C-03 360 boards: a stroke over the join does not jump across the board', () => {
  assert.equal(unwrapX(10, 7990, 8000), 8010);
  assert.equal(unwrapX(7990, 10, 8000), -10);
  assert.equal(unwrapX(500, 400, 8000), 500);
  assert.equal(unwrapX(10, 7990, 0), 10, 'flat board unchanged');
});

test('C-04 stroke bounds include the pen radius', () => {
  assert.deepEqual(opBounds({ type: 'stroke', x0: 10, y0: 10, x1: 20, y1: 30, size: 10 }), { minX: 3, maxX: 27, minY: 3, maxY: 37 });
  assert.deepEqual(opBounds({ lastX: 10, lastY: 10, x: 20, y: 30, size: 10 }), { minX: 3, maxX: 27, minY: 3, maxY: 37 });
});

test('C-05 export file name: board name + date and time', () => {
  assert.match(exportFilename('Weekly planning!', 'ABCDE'), /^Weekly-planning_\d{4}-\d{2}-\d{2}_\d{4}\.png$/);
  assert.match(exportFilename('', 'ABCDE'), /^whiteboard-ABCDE_/);
  assert.match(exportFilename('***', 'X'), /^whiteboard_/);
});

test('C-06 sizes and presets', () => {
  assert.deepEqual(BOARD_SIZES.map((s) => s.label), ['Standard', 'Wide', 'Large', 'Wall', 'Long wall', 'Tall']);
  assert.equal(describeSize(1500, 1000), '1.5 × 1 m');
  assert.equal(presetFor(4000, 2000).label, 'Wall');
  assert.equal(presetFor(8000, 2000).label, 'Long wall');
  assert.equal(SIZE_LIMITS.maxWidth, 8000);
  assert.equal(presetFor(1230, 990), null);
  assert.ok(isWrapBoard({ shape: 'cylinder' }));
  assert.ok(!isWrapBoard({ shape: 'flat' }));
  assert.equal(describeWrapSize(8000, 1800), '8 m around × 1.8 m high');
  assert.equal(normalizeRoom(' abcde '), 'ABCDE');
});

test('C-07 remove guard: needs three presses, each within the window', async () => {
  const events = [];
  const guard = createMultiClick({
    count: 3, windowMs: 50,
    onProgress: (left) => events.push('left ' + left),
    onConfirm: (t) => events.push('confirm ' + t),
    onReset: () => events.push('reset')
  });
  guard.press('b1');
  guard.press('b1');
  guard.press('b1');
  assert.deepEqual(events, ['left 2', 'left 1', 'confirm b1']);

  events.length = 0;
  guard.press('b1');
  await new Promise((r) => setTimeout(r, 80));
  guard.press('b1');
  assert.deepEqual(events, ['left 2', 'reset', 'left 2'], 'times out and starts over');

  events.length = 0;
  guard.press('b2'); // switched boards
  guard.press('b2');
  guard.press('b2');
  assert.deepEqual(events, ['left 2', 'left 1', 'confirm b2'], 'a different board starts over');
  guard.reset(false);
});

// ---- VR headset fixes (bugs V1 to V13) ----
import { panelSpot, FORWARD, DROP } from '../src/vr/tool-panel.js';
import { canDrawAt, setReachMode, NEAR_REACH, LONG_REACH } from '../src/vr/reach.js';
import { layoutBoards, FIRST_Z, FIRST_BOTTOM } from '../src/vr/layout.js';

test('C-08 tool panel goes in front of and below the eyes, never too low', () => {
  const s = panelSpot({ x: 0, y: 1.6, z: 0.1, yaw: 0 });
  assert.ok(Math.abs(s.z - (0.1 - FORWARD)) < 1e-9, 'straight ahead');
  assert.ok(Math.abs(s.y - (1.6 - DROP)) < 1e-9, 'below the eyes');
  const turned = panelSpot({ x: 0, y: 1.6, z: 0, yaw: Math.PI / 2 }); // looking towards -x
  assert.ok(Math.abs(turned.x + FORWARD) < 1e-9 && Math.abs(turned.z) < 1e-9, 'follows the head turn');
  assert.ok(panelSpot({ x: 0, y: 0.7, z: 0, yaw: 0 }).y >= 0.5, 'sitting on the floor: not under the floor');
});

test('C-09 reach setting limits drawing only', () => {
  global.document = { querySelectorAll: () => [] }; // no controllers outside a browser
  setReachMode('short');
  assert.equal(canDrawAt(NEAR_REACH), true);
  assert.equal(canDrawAt(NEAR_REACH + 0.01), false, '20 cm: a board further away is not drawn on');
  setReachMode('long');
  assert.equal(canDrawAt(LONG_REACH - 0.1), true);
  delete global.document;
});

test('C-10 first board sits beyond the tool panel, above it', () => {
  const [first] = layoutBoards([{ width: 1500, height: 1000 }]);
  assert.equal(first.position[2], FIRST_Z);
  assert.ok(first.position[1] - 0.5 >= FIRST_BOTTOM - 1e-9, 'lower edge at or above FIRST_BOTTOM');
  const [wide] = layoutBoards([{ width: 4000, height: 2000 }]);
  assert.equal(wide.position[2], FIRST_Z, 'a big board no longer moves; the panel is not around it');
});

// ---- Headset feedback round 2 ----
import { lookColor, lookGrow, COLORS, PRESS_GROW } from '../src/vr/button-look.js';

test('C-11 panel controls share one colour scheme', () => {
  const s = (o) => Object.assign({ hovered: false, active: false, enabled: true, flashing: false }, o);
  const plain = { color: COLORS.normal };
  assert.equal(lookColor(s({}), plain), COLORS.normal);
  assert.equal(lookColor(s({ hovered: true }), plain), COLORS.hover, 'one hover colour');
  assert.equal(lookColor(s({ hovered: true }), { color: COLORS.danger }), COLORS.hover, 'red buttons hover the same');
  assert.equal(lookColor(s({ active: true }), plain), COLORS.active, 'a mode that is on');
  assert.equal(lookColor(s({ active: true, hovered: true, flashing: true }), plain), COLORS.flash, 'a press shows over everything');
  assert.equal(lookColor(s({ enabled: false, hovered: true }), plain), COLORS.disabled);
  assert.equal(lookColor(s({ hovered: true, active: true }), { color: '#ED5564', keepColor: true }), '#ED5564', 'colour discs keep their colour');
  assert.equal(lookGrow(s({ flashing: true }), plain), PRESS_GROW, 'grows when pressed');
  assert.equal(lookGrow(s({}), plain), 1);
  assert.equal(lookGrow(s({ active: true }), { activeGrow: 1.25 }), 1.25);
});

// A stand-in canvas: records its size and the draw calls, nothing else.
function fakeCanvas() {
  const c = { width: 300, height: 150, calls: 0 };
  const ctx = {
    canvas: c,
    save() {}, restore() {}, translate() {}, setTransform() {}, beginPath() {}, moveTo() {}, lineTo() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    fillRect() {}, clearRect() {}, drawImage() { c.calls++; }, stroke() { c.calls++; }
  };
  c.getContext = () => ctx;
  return c;
}

test('C-12 wide boards are cut into 1 m tiles', () => {
  assert.deepEqual(tileRanges(2500).map((t) => [t.x0, t.width]), [[0, 1000], [1000, 1000], [2000, 500]]);
  assert.equal(tileRanges(8000).length, 8);
  const r = tileRanges(3000);
  assert.deepEqual(tilesTouched(r, { minX: 990, maxX: 1010 }), [0, 1], 'a stroke over a tile edge touches both');
  assert.deepEqual(tilesTouched(r, { minX: 2990, maxX: 3010 }, 3000), [0, 2], '360 board: over the join');
  assert.deepEqual(tilesTouched(r, null), [0, 1, 2]);
});

test('C-13 blank tiles take no memory until drawn on, and erasing frees them', () => {
  globalThis.document = { createElement: () => fakeCanvas() };   // for the hidden ink layer
  const changes = [];
  const store = createTileStore(8000, 2500, { makeCanvas: fakeCanvas, onTileChange: (t) => changes.push(t.index) });
  assert.equal(store.liveTiles(), 0);
  assert.ok(store.tiles.every((t) => t.canvas.width === 1 && t.canvas.height === 1), 'blank tiles are 1 x 1');
  changes.length = 0;
  store.drawSegment({ lastX: 1500, lastY: 100, x: 1600, y: 200, size: 10, color: '#000' });
  assert.equal(store.liveTiles(), 1);
  assert.deepEqual([store.tiles[1].canvas.width, store.tiles[1].canvas.height], [1000, 2500]);
  assert.deepEqual(changes, [1], 'only the touched tile is re-sent');
  store.drawSegment({ lastX: 5000, lastY: 100, x: 5100, y: 200, size: 10, clearing: true });
  assert.equal(store.liveTiles(), 1, 'erasing a blank tile leaves it blank');
  store.replay({ ops: [{ type: 'stroke', x0: 10, y0: 10, x1: 20, y1: 20, size: 5, color: '#000' }] });
  assert.equal(store.liveTiles(), 1);
  assert.equal(store.tiles[0].live, true);
  assert.equal(store.tiles[1].live, false, 'replay starts from a blank board');
  store.clear();
  assert.equal(store.liveTiles(), 0);
  assert.ok(store.resize(4000, 2000));
  assert.equal(store.tiles.length, 4);
});

test('C-14 exports too big for iPhone / iPad are scaled down', () => {
  assert.deepEqual(exportSize(4000, 2000), { width: 4000, height: 2000, scale: 1 });
  const big = exportSize(8000, 2500);
  assert.ok(big.width * big.height <= MAX_CANVAS_PIXELS);
  assert.ok(Math.abs(big.width / big.height - 3.2) < 0.01, 'keeps its shape');
});
