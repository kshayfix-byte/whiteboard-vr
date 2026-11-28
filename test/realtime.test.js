// Automated checks for live sync over Socket.io (lib/realtime.js): two or
// three clients talk to a real server on a random port.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const ioServer = require('socket.io');
const ioClient = require('socket.io-client');
const { setup } = require('../lib/realtime');

let server, url, store, dataDir;
const clients = [];

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbvr-rt-'));
  const app = express();
  server = http.createServer(app);
  const io = ioServer(server);
  store = setup(app, io, { dataDir });
  await new Promise((resolve) => server.listen(0, resolve));
  url = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  clients.forEach((c) => c.close());
  store.timers.forEach((t) => clearTimeout(t));
  server.close();
  // setup() adds SIGINT/SIGTERM handlers that call process.exit; drop them.
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
});

function connect() {
  const c = ioClient(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  return c;
}
const once = (c, ev, ms = 2000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timed out waiting for ' + ev)), ms);
  c.once(ev, (data) => { clearTimeout(t); resolve(data); });
});
const emitAck = (c, ev, msg) => new Promise((resolve) => c.emit(ev, msg, resolve));
const nothingWithin = (c, ev, ms = 300) => new Promise((resolve, reject) => {
  const handler = () => reject(new Error('unexpected ' + ev));
  c.once(ev, handler);
  setTimeout(() => { c.off(ev, handler); resolve(); }, ms);
});
async function join(room) {
  const c = connect();
  const state = once(c, 'boardState');
  c.emit('join', { room });
  return { c, first: await state };
}

test('S-01 join sends the room\'s board; a late joiner sees earlier strokes', async () => {
  const { c: a, first } = await join('sync1');
  assert.equal(first.room, 'SYNC1', 'room code is upper-cased');
  assert.equal(first.board, 'main');
  a.emit('draw', { room: 'SYNC1', board: 'main', lastX: 1, lastY: 1, x: 5, y: 5, size: 10, color: '#000' });
  await new Promise((r) => setTimeout(r, 150));
  const { first: late } = await join('SYNC1');
  assert.equal(late.ops.length, 1);
});

test('S-02 strokes reach others in the same room only', async () => {
  const { c: a } = await join('ROOMA');
  const { c: b } = await join('ROOMA');
  const { c: other } = await join('ROOMB');
  const got = once(b, 'remoteDraw');
  const quiet = nothingWithin(other, 'remoteDraw');
  const quietSelf = nothingWithin(a, 'remoteDraw');
  a.emit('draw', { room: 'ROOMA', board: 'main', lastX: 1, lastY: 1, x: 9, y: 9, size: 10, color: '#00f' });
  const msg = await got;
  assert.equal(msg.x, 9);
  await quiet;
  await quietSelf;
});

test('S-03 a draw for the wrong room or a bad stroke is ignored', async () => {
  const { c: a } = await join('ROOMC');
  const { c: b } = await join('ROOMC');
  const quiet = nothingWithin(b, 'remoteDraw');
  a.emit('draw', { room: 'ROOMZ', board: 'main', lastX: 1, lastY: 1, x: 2, y: 2, size: 10 });
  a.emit('draw', { room: 'ROOMC', board: 'main', lastX: 'x', lastY: 1, x: 2, y: 2, size: 10 });
  await quiet;
  assert.equal(store.findBoard('ROOMC', 'main').ops.length, 0);
});

test('S-04 erase all reaches the others and clears the stored board', async () => {
  const { c: a } = await join('ROOMD');
  const { c: b } = await join('ROOMD');
  a.emit('draw', { room: 'ROOMD', board: 'main', lastX: 1, lastY: 1, x: 2, y: 2, size: 10 });
  await once(b, 'remoteDraw');
  const got = once(b, 'remoteEraseAll');
  a.emit('eraseAll', { room: 'ROOMD', board: 'main' });
  await got;
  assert.equal(store.findBoard('ROOMD', 'main').ops.length, 0);
});

test('S-05 add and remove whiteboard are shared with the room', async () => {
  const { c: a } = await join('ROOME');
  const { c: b } = await join('ROOME');
  const added = once(b, 'boardState');
  const res = await emitAck(a, 'addBoard', { room: 'ROOME', shape: 'cylinder' });
  assert.ok(res.ok);
  const state = await added;
  assert.equal(state.board, res.board);
  assert.equal(state.shape, 'cylinder');
  const removed = once(b, 'boardRemoved');
  assert.ok((await emitAck(a, 'removeBoard', { room: 'ROOME', board: res.board })).ok);
  assert.equal((await removed).board, res.board);
  const last = await emitAck(a, 'removeBoard', { room: 'ROOME', board: 'main' });
  assert.equal(last.ok, false);
});

test('S-06 save, rename and save all over the socket', async () => {
  const { c: a } = await join('ROOMF');
  const need = await emitAck(a, 'saveBoard', { room: 'ROOMF', board: 'main' });
  assert.equal(need.needsName, true);
  assert.ok((await emitAck(a, 'saveBoard', { room: 'ROOMF', board: 'main', name: 'Plan' })).ok);
  assert.equal((await emitAck(a, 'renameBoard', { room: 'ROOMF', board: 'main', name: 'Plan B' })).name, 'Plan B');
  assert.deepEqual(await emitAck(a, 'saveAll', { room: 'ROOMF' }), { ok: true, count: 1 });
  const notJoined = connect();
  const refused = await emitAck(notJoined, 'saveAll', { room: 'ROOMF' });
  assert.equal(refused.ok, false, 'a socket that has not joined the room is refused');
});

test('S-07 resize is broadcast; a stale-size stroke is shifted to match', async () => {
  const { c: a } = await join('ROOMG');
  const { c: b } = await join('ROOMG');
  const resized = once(b, 'boardState');
  assert.ok((await emitAck(a, 'resizeBoard', { room: 'ROOMG', board: 'main', width: 3000, height: 1000 })).ok);
  assert.equal((await resized).width, 3000);
  const got = once(b, 'remoteDraw');
  a.emit('draw', { room: 'ROOMG', board: 'main', lastX: 100, lastY: 100, x: 110, y: 110, size: 10, bw: 1500, bh: 1000 });
  const msg = await got;
  assert.equal(msg.x, 110 + 750);
  const bad = await emitAck(a, 'resizeBoard', { room: 'ROOMG', board: 'main', width: 9000, height: 1000 });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /m wide/);
});

test('S-08 moving a board is shared live; null puts it back in auto layout', async () => {
  const { c: a } = await join('ROOMH');
  const { c: b } = await join('ROOMH');
  const moved = once(b, 'boardPose');
  await emitAck(a, 'moveBoard', { room: 'ROOMH', board: 'main', pose: { position: [1, 1.5, -2], rotationY: 15 }, live: true });
  assert.deepEqual((await moved).pose, { position: [1, 1.5, -2], rotationY: 15 });
  const back = once(b, 'boardPose');
  await emitAck(a, 'moveBoard', { room: 'ROOMH', board: 'main', pose: null, live: false });
  assert.equal((await back).pose, null);
});

test('S-09 REST: saved boards list, room info, recovery', async () => {
  const get = (p) => new Promise((resolve, reject) => {
    http.get(url + p, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });
  const list = await get('/api/boards');
  assert.ok(list.json.boards.some((b) => b.name === 'Plan B'));
  const room = await get('/api/boards/roomf');
  assert.equal(room.json.room, 'ROOMF');
  assert.equal(room.json.allNamed, true);
  assert.equal((await get('/api/boards/bad%20room!')).status, 400);
  const rec = await get('/api/recovery');
  assert.ok(Array.isArray(rec.json.items));
});

test('S-10 restore with a new name, and restore-and-save', async () => {
  const post = (p, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; });
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.on('error', reject);
    req.end(data);
  });
  const entry = (room) => ({ version: 2, room, boards: { main: { name: 'Whiteboard_1234', ops: [{ type: 'stroke', x0: 1, y0: 1, x1: 2, y1: 2, size: 5, color: '#000' }] } } });
  fs.writeFileSync(path.join(dataDir, 'recovery', 'RECX.main.1.json'), JSON.stringify(entry('RECX')));
  fs.writeFileSync(path.join(dataDir, 'recovery', 'RECY.main.1.json'), JSON.stringify(entry('RECY')));
  const renamed = await post('/api/recovery/restore', { ids: ['RECX.main.1'], names: { 'RECX.main.1': 'Sketches' } });
  assert.equal(renamed.results[0].name, 'Sketches');
  assert.equal(store.findBoard('RECX', 'main').named, false, 'renamed but not saved');
  const saved = await post('/api/recovery/restore', { ids: ['RECY.main.1'], save: true });
  assert.equal(saved.results[0].saved, true);
  assert.equal(saved.results[0].name, 'Whiteboard_1234', 'saved under the name shown');
  assert.equal(store.findBoard('RECY', 'main').named, true);
  assert.ok(fs.existsSync(path.join(dataDir, 'RECY.json')));
});
