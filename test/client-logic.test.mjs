// Automated checks for browser-side logic that needs no browser:
// src/board-client.js helpers and the triple-click guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightTint, wrapCopies, unwrapX, opBounds, exportFilename,
  describeSize, presetFor, BOARD_SIZES, isWrapBoard, describeWrapSize, normalizeRoom
} from '../src/board-client.js';
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
  assert.deepEqual(BOARD_SIZES.map((s) => s.label), ['Standard', 'Wide', 'Large', 'Wall', 'Tall']);
  assert.equal(describeSize(1500, 1000), '1.5 × 1 m');
  assert.equal(presetFor(4000, 2000).label, 'Wall');
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
