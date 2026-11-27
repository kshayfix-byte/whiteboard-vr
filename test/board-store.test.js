// Automated checks for the server's board store (lib/board-store.js).
// Run with `npm test`. Each test uses its own temporary data folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BoardStore,
  isValidRoom,
  normalizeRoom,
  boardIdOrDefault,
  strokeFromDraw,
  cleanName,
  cleanFlatSize,
  cleanShape,
  cleanPose,
  shiftOp,
  temporaryName,
  WRAP_WIDTH,
  WRAP_HEIGHT
} = require('../lib/board-store');

const stores = [];
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wbvr-test-'));
}
function newStore(dir) {
  const store = new BoardStore(dir || tempDir());
  stores.push(store);
  return store;
}
// Stop pending autosave timers so the test run can exit.
test.after(() => stores.forEach((s) => s.timers.forEach((t) => clearTimeout(t))));

const stroke = (x = 10, extra = {}) => strokeFromDraw(Object.assign({ lastX: x, lastY: 10, x: x + 5, y: 15, size: 10, color: '#ff0000' }, extra));

// ---------- U-01..U-09: pure helpers ----------

test('U-01 rooms: valid codes, normalised to upper case', () => {
  assert.equal(normalizeRoom(' abc12 '), 'ABC12');
  assert.ok(isValidRoom('ABC12'));
  assert.ok(!isValidRoom(''));
  assert.ok(!isValidRoom('../etc'));
  assert.ok(!isValidRoom('A'.repeat(33)));
  assert.ok(!isValidRoom(42));
});

test('U-02 board ids fall back to "main"', () => {
  assert.equal(boardIdOrDefault('b12345'), 'b12345');
  assert.equal(boardIdOrDefault('../x'), 'main');
  assert.equal(boardIdOrDefault(undefined), 'main');
});

test('U-03 draw messages are validated and turned into stroke ops', () => {
  const op = stroke();
  assert.deepEqual(op, { type: 'stroke', x0: 10, y0: 10, x1: 15, y1: 15, color: '#ff0000', size: 10, erase: false });
  assert.equal(strokeFromDraw({ lastX: 'a', lastY: 1, x: 1, y: 1, size: 5 }), null, 'non-numeric coords');
  assert.equal(strokeFromDraw({ lastX: 1, lastY: 1, x: 1, y: 1, size: 0 }), null, 'zero size');
  assert.equal(strokeFromDraw({ lastX: 1, lastY: 1, x: 1, y: 1, size: 501 }), null, 'huge size');
  assert.equal(strokeFromDraw(null), null);
  assert.equal(stroke(10, { color: 'url(javascript:1)' }).color, '#000000', 'bad colour becomes black');
  assert.equal(stroke(10, { clearing: true }).erase, true, 'eraser');
  assert.equal(stroke(10, { clearing: 'true' }).erase, true, 'eraser sent as string');
});

test('U-04 highlighter flags are stored only when on', () => {
  assert.equal(stroke().highlight, undefined);
  assert.equal(stroke(10, { highlight: true }).highlight, true);
  const hlErase = stroke(10, { highlight: true, clearing: true });
  assert.equal(hlErase.highlight, true);
  assert.equal(hlErase.erase, true);
});

test('U-05 names are cleaned and limited to 80 characters', () => {
  assert.equal(cleanName('  Weekly\u0007 plan  '), 'Weekly plan');
  assert.equal(cleanName('x'.repeat(200)).length, 80);
  assert.equal(cleanName(null), '');
  assert.match(temporaryName(), /^Whiteboard_\d{4}$/);
});

test('U-06 flat sizes: 0.5-4 m wide, 0.5-2.5 m high, whole centimetres', () => {
  assert.deepEqual(cleanFlatSize(4000, 2000), { width: 4000, height: 2000 });
  assert.deepEqual(cleanFlatSize(1234, 987), { width: 1230, height: 990 });
  assert.equal(cleanFlatSize(9000, 1000), null);
  assert.equal(cleanFlatSize(400, 1000), null);
  assert.equal(cleanFlatSize(1500, 2600), null);
  assert.equal(cleanFlatSize('abc', 1000), null);
});

test('U-07 shapes: only "cylinder" is special', () => {
  assert.equal(cleanShape('cylinder'), 'cylinder');
  assert.equal(cleanShape('sphere'), 'flat');
  assert.equal(cleanShape(undefined), 'flat');
});

test('U-08 poses are cleaned and kept inside the room', () => {
  assert.equal(cleanPose(null), null);
  assert.equal(cleanPose({ position: [1, 2] }), null);
  assert.equal(cleanPose({ position: [1, NaN, 2] }), null);
  assert.deepEqual(cleanPose({ position: [1.23456, 1.5, -2], rotationY: -90 }), { position: [1.235, 1.5, -2], rotationY: 270 });
  const far = cleanPose({ position: [100, 50, 0], rotationY: 720 });
  assert.deepEqual(far, { position: [30, 10, 0], rotationY: 0 }, 'clamped to 30 m away and 10 m high');
  assert.equal(cleanPose({ position: [0, -3, 0] }).position[1], 0, 'never below the floor');
});

test('U-09 shiftOp moves every coordinate', () => {
  const op = shiftOp({ type: 'stroke', x0: 1, y0: 2, x1: 3, y1: 4, size: 5 }, 10, 20);
  assert.deepEqual([op.x0, op.y0, op.x1, op.y1, op.size], [11, 22, 13, 24, 5]);
});

// ---------- U-10..U-25: BoardStore ----------

test('U-10 a new room gets one board, "main", with a temporary name and standard size', () => {
  const store = newStore();
  const boards = store.ensureBoard('ROOM1');
  assert.equal(boards.length, 1);
  assert.equal(boards[0].id, 'main');
  assert.match(boards[0].name, /^Whiteboard_\d{4}$/);
  assert.equal(boards[0].named, false);
  assert.deepEqual([boards[0].width, boards[0].height, boards[0].shape], [1500, 1000, 'flat']);
  assert.equal(store.roomInfo('ROOM1').allNamed, false);
});

test('U-11 add whiteboard: flat and 360, in creation order, max 50', () => {
  const store = newStore();
  store.ensureBoard('R');
  const flat = store.addBoard('R');
  const wrap = store.addBoard('R', 'cylinder');
  assert.ok(flat.ok && wrap.ok);
  assert.equal(wrap.shape, 'cylinder');
  const ids = store.boardList('R').map((b) => b.id);
  assert.deepEqual(ids, ['main', flat.board, wrap.board]);
  const w = store.findBoard('R', wrap.board);
  assert.deepEqual([w.width, w.height], [WRAP_WIDTH, WRAP_HEIGHT]);
  for (let i = 3; i < 50; i++) assert.ok(store.addBoard('R').ok);
  const tooMany = store.addBoard('R');
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /50/);
});

test('U-12 draw and erase all change only the target board', () => {
  const store = newStore();
  store.ensureBoard('R');
  const b2 = store.addBoard('R').board;
  assert.equal(store.addOp('R', 'main', stroke()).becameDirty, true);
  assert.equal(store.addOp('R', 'main', stroke(20)).becameDirty, false, 'only the first change reports dirty');
  store.addOp('R', b2, stroke());
  assert.equal(store.addOp('R', 'nosuchboard', stroke()).ok, false, 'no phantom boards');
  assert.equal(store.findBoard('R', 'nosuchboard'), null);
  store.clearBoard('R', 'main');
  assert.equal(store.findBoard('R', 'main').ops.length, 0);
  assert.equal(store.findBoard('R', b2).ops.length, 1);
});

test('U-13 remove whiteboard: copy kept, last board refused', () => {
  const dir = tempDir();
  const store = newStore(dir);
  store.ensureBoard('R');
  const b2 = store.addBoard('R').board;
  store.addOp('R', b2, stroke());
  const res = store.removeBoard('R', b2);
  assert.ok(res.ok);
  assert.equal(store.findBoard('R', b2), null);
  const copies = fs.readdirSync(path.join(dir, 'removed'));
  assert.equal(copies.length, 1);
  assert.ok(copies[0].startsWith('R.' + b2 + '.'));
  const last = store.removeBoard('R', 'main');
  assert.equal(last.ok, false, 'the only board cannot be removed');
  assert.equal(store.removeBoard('R', 'ghost').ok, false);
});

test('U-14 first Save needs a name; later saves keep it', () => {
  const store = newStore();
  store.ensureBoard('R');
  const noName = store.saveBoard('R', 'main', '   ');
  assert.equal(noName.ok, false);
  assert.equal(noName.needsName, true);
  assert.ok(store.saveBoard('R', 'main', 'Planning').ok);
  const again = store.saveBoard('R', 'main');
  assert.equal(again.ok, true);
  assert.equal(again.name, 'Planning');
});

test('U-15 Save all is refused until every board was named with its own Save', () => {
  const store = newStore();
  store.ensureBoard('R');
  const b2 = store.addBoard('R').board;
  store.saveBoard('R', 'main', 'One');
  assert.equal(store.saveAll('R').ok, false);
  store.renameBoard('R', b2, 'Two');
  assert.equal(store.saveAll('R').ok, false, 'Rename alone does not count as naming');
  store.saveBoard('R', b2, 'Two');
  assert.equal(store.roomInfo('R').allNamed, true);
  assert.deepEqual(store.saveAll('R'), { ok: true, count: 2 });
});

test('U-16 Rename: empty refused; a saved board file is updated at once', () => {
  const dir = tempDir();
  const store = newStore(dir);
  store.ensureBoard('R');
  assert.equal(store.renameBoard('R', 'main', '  ').ok, false);
  store.saveBoard('R', 'main', 'Old');
  assert.ok(store.renameBoard('R', 'main', 'New').ok);
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'R.json'), 'utf8'));
  assert.equal(file.boards.main.name, 'New');
});

test('U-17 saved boards survive a restart, in order, with size, shape and pose', () => {
  const dir = tempDir();
  const a = newStore(dir);
  a.ensureBoard('R');
  const wrap = a.addBoard('R', 'cylinder').board;
  a.addOp('R', 'main', stroke());
  a.resizeBoard('R', 'main', 4000, 2000);
  a.setBoardPose('R', 'main', { position: [1, 1.5, -3], rotationY: 30 });
  a.saveBoard('R', 'main', 'Main');
  a.saveBoard('R', wrap, 'Round');
  a.shutdown();

  const b = newStore(dir);
  assert.equal(b.uncleanShutdown, false);
  const list = b.boardList('R');
  assert.deepEqual(list.map((x) => x.name), ['Main', 'Round']);
  assert.deepEqual([list[0].width, list[0].height], [4000, 2000]);
  assert.deepEqual(list[0].pose, { position: [1, 1.5, -3], rotationY: 30 });
  assert.equal(list[0].ops.length, 1);
  assert.equal(list[1].shape, 'cylinder');
  assert.ok(b.list().some((x) => x.name === 'Round'), 'Saved boards list');
});

test('U-18 autosave: a named board writes its changes to the saved file', () => {
  const dir = tempDir();
  const store = newStore(dir);
  store.ensureBoard('R');
  store.saveBoard('R', 'main', 'Auto');
  let autosaved = null;
  store.onAutosave = (room) => { autosaved = room; };
  store.addOp('R', 'main', stroke());
  const saved = store.flushRoom('R'); // what the 3 s timer does
  assert.deepEqual(saved, ['main']);
  assert.equal(autosaved, 'R');
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'R.json'), 'utf8'));
  assert.equal(file.boards.main.ops.length, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'drafts', 'R.json')), 'no backup for a named board');
});

test('U-19 resize grows/shrinks around the centre and shrink-then-grow restores coordinates', () => {
  const store = newStore();
  store.ensureBoard('R');
  store.addOp('R', 'main', stroke(100));
  const before = Object.assign({}, store.findBoard('R', 'main').ops[0]);
  assert.ok(store.resizeBoard('R', 'main', 3000, 1000).ok);
  assert.equal(store.findBoard('R', 'main').ops[0].x0, before.x0 + 750);
  store.resizeBoard('R', 'main', 1000, 1000);
  store.resizeBoard('R', 'main', 1500, 1000);
  assert.deepEqual(store.findBoard('R', 'main').ops[0], before);
  assert.equal(store.resizeBoard('R', 'main', 1500, 1000).unchanged, true);
  assert.equal(store.resizeBoard('R', 'main', 9000, 1000).ok, false);
  const wrap = store.addBoard('R', 'cylinder').board;
  assert.equal(store.resizeBoard('R', wrap, 2000, 1000).ok, false, '360 boards have a fixed size');
});

test('U-20 board pose: set, unchanged, invalid, back to auto (null)', () => {
  const store = newStore();
  store.ensureBoard('R');
  const pose = { position: [2, 1.4, -1], rotationY: 45 };
  assert.ok(store.setBoardPose('R', 'main', pose).ok);
  assert.equal(store.setBoardPose('R', 'main', pose).unchanged, true);
  assert.equal(store.setBoardPose('R', 'main', { position: 'x' }).ok, false);
  assert.ok(store.setBoardPose('R', 'main', null).ok);
  assert.equal(store.findBoard('R', 'main').pose, null);
});

test('U-21 old or broken saved files load with defaults', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'OLD.json'), JSON.stringify({
    boards: { main: { ops: [{ type: 'stroke', x0: 1, y0: 1, x1: 2, y1: 2, size: 5, color: '#000' }], width: 99999, pose: { position: 'bad' }, shape: 'sphere' } }
  }));
  fs.writeFileSync(path.join(dir, 'BROKEN.json'), '{not json');
  const store = newStore(dir);
  const b = store.findBoard('OLD', 'main');
  assert.ok(b.name, 'gets a name');
  assert.deepEqual([b.width, b.height, b.shape, b.pose], [1500, 1000, 'flat', null]);
  assert.equal(b.ops.length, 1);
  assert.deepEqual(store.ensureBoard('BROKEN').map((x) => x.id), ['main'], 'unreadable file = fresh room');
});

test('U-22 unnamed boards are backed up; after a crash they can be restored or discarded', () => {
  const dir = tempDir();
  const a = newStore(dir);
  a.ensureBoard('R');
  const b2 = a.addBoard('R').board;
  a.addOp('R', 'main', stroke());
  a.addOp('R', b2, stroke());
  a.addOp('R', b2, stroke(30));
  a.setBoardPose('R', b2, { position: [3, 1, 0], rotationY: 90 });
  a.writeDraft('R'); // what the timer does
  assert.ok(fs.existsSync(path.join(dir, 'drafts', 'R.json')));
  // No shutdown(): simulates a crash (the .running marker stays).

  const b = newStore(dir);
  const info = b.recoveryInfo();
  assert.equal(info.uncleanShutdown, true);
  assert.equal(info.items.length, 2);
  const two = info.items.find((i) => i.board === b2);
  assert.equal(two.strokes, 2);
  const one = info.items.find((i) => i.board === 'main');
  assert.ok(b.discard(one.id).ok);
  const restored = b.restore(two.id);
  assert.ok(restored.ok);
  assert.equal(restored.room, 'R');
  const board = b.findBoard('R', restored.board);
  assert.equal(board.ops.length, 2);
  assert.equal(board.named, false);
  assert.equal(board.restored, true);
  assert.deepEqual(board.pose, { position: [3, 1, 0], rotationY: 90 });
  assert.equal(b.recoveryItems().length, 0);
  assert.equal(b.restore('../../etc/passwd').ok, false, 'path tricks refused');
});

test('U-23 a clean shutdown is reported as clean but still offers unsaved boards', () => {
  const dir = tempDir();
  const a = newStore(dir);
  a.ensureBoard('R');
  a.addOp('R', 'main', stroke());
  a.shutdown();
  const b = newStore(dir);
  const info = b.recoveryInfo();
  assert.equal(info.uncleanShutdown, false);
  assert.equal(info.items.length, 1);
});

test('U-24 restoring onto a board that has content adds an extra board instead', () => {
  const dir = tempDir();
  const a = newStore(dir);
  a.ensureBoard('R');
  a.addOp('R', 'main', stroke());
  a.writeDraft('R');
  const b = newStore(dir);
  b.ensureBoard('R');
  b.addOp('R', 'main', stroke(50)); // someone drew on the new main board
  const item = b.recoveryItems()[0];
  const res = b.restore(item.id);
  assert.ok(res.ok);
  assert.equal(res.room, 'R');
  assert.notEqual(res.board, 'main');
  assert.equal(b.boardList('R').length, 2);
});

test('U-25 removing a saved board also removes it from the saved file', () => {
  const dir = tempDir();
  const a = newStore(dir);
  a.ensureBoard('R');
  const b2 = a.addBoard('R').board;
  a.saveBoard('R', 'main', 'Keep');
  a.saveBoard('R', b2, 'Gone');
  a.removeBoard('R', b2);
  a.shutdown();
  const b = newStore(dir);
  assert.deepEqual(b.boardList('R').map((x) => x.name), ['Keep']);
});
