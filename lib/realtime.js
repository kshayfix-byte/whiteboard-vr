// Socket.io + REST wiring shared by server.js and server-ssl.js.
const path = require('path');
const express = require('express');
const {
  BoardStore,
  isValidRoom,
  boardIdOrDefault,
  normalizeRoom,
  strokeFromDraw
} = require('./board-store');

function boardPayload(store, room, boardId) {
  const board = store.getBoard(room, boardId);
  if (!board) return null;
  return {
    room: room,
    board: board.id,
    name: board.name,
    named: board.named,
    dirty: board.dirty,
    savedAt: board.savedAt,
    width: board.width,
    height: board.height,
    shape: board.shape,
    background: board.background,
    ops: board.ops,
    info: store.roomInfo(room)
  };
}

function setup(app, io, options) {
  options = options || {};
  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const store = new BoardStore(dataDir);

  app.use(express.static('dist'));

  app.get('/api/boards', (req, res) => {
    res.json({ boards: store.list() });
  });

  // Unsaved boards left over from the last run (e.g. after a crash).
  app.get('/api/recovery', (req, res) => {
    res.json(store.recoveryInfo());
  });

  app.post('/api/recovery/restore', express.json({ limit: '50kb' }), (req, res) => {
    const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids.slice(0, 200) : [];
    const results = ids.map((id) => {
      const result = store.restore(id);
      if (result.ok) {
        // Show the restored board to anyone already in that room.
        io.to(result.room).emit('boardState', boardPayload(store, result.room, result.board));
        io.to(result.room).emit('roomInfo', store.roomInfo(result.room));
      }
      return result;
    });
    res.json({ results: results, remaining: store.recoveryItems().length });
  });

  app.post('/api/recovery/discard', express.json({ limit: '50kb' }), (req, res) => {
    const ids = (req.body && Array.isArray(req.body.ids)) ? req.body.ids.slice(0, 200) : [];
    res.json({ results: ids.map((id) => store.discard(id)), remaining: store.recoveryItems().length });
  });

  // Tell a room when its named boards were autosaved.
  store.onAutosave = (room) => io.to(room).emit('roomInfo', store.roomInfo(room));

  app.get('/api/boards/:room', (req, res) => {
    const room = normalizeRoom(req.params.room);
    if (!isValidRoom(room)) return res.status(400).json({ error: 'invalid room' });
    res.json(store.roomInfo(room));
  });

  io.on('connection', (socket) => {
    let currentRoom = null;

    const inRoom = (msg) => currentRoom && msg && normalizeRoom(msg.room) === currentRoom;
    const sendInfo = () => io.to(currentRoom).emit('roomInfo', store.roomInfo(currentRoom));
    const reply = (ack, result) => { if (typeof ack === 'function') ack(result); };

    // Clients send `join` on every (re)connect and get the current board back.
    socket.on('join', (msg) => {
      const room = normalizeRoom(msg && msg.room);
      if (!isValidRoom(room)) return;
      if (currentRoom && currentRoom !== room) socket.leave(currentRoom);
      currentRoom = room;
      socket.join(room);
      const payload = boardPayload(store, room, msg.board);
      if (payload) socket.emit('boardState', payload);
      sendInfo(); // the board may have just been created
    });

    socket.on('draw', (obj) => {
      if (!inRoom(obj)) return;
      const op = strokeFromDraw(obj);
      if (!op) return;
      const result = store.addOp(currentRoom, obj.board, op);
      if (!result.ok) return;
      socket.to(currentRoom).emit('remoteDraw', obj);
      if (result.becameDirty) sendInfo();
    });

    socket.on('eraseAll', (obj) => {
      if (!inRoom(obj)) return;
      const result = store.clearBoard(currentRoom, obj.board);
      if (!result.ok) return;
      socket.to(currentRoom).emit('remoteEraseAll', obj);
      if (result.becameDirty) sendInfo();
    });

    socket.on('saveBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.saveBoard(currentRoom, boardIdOrDefault(msg.board), msg.name);
      reply(ack, result);
      if (result.ok) sendInfo();
    });

    socket.on('saveAll', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.saveAll(currentRoom);
      reply(ack, result);
      if (result.ok) sendInfo();
    });

    socket.on('renameBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.renameBoard(currentRoom, boardIdOrDefault(msg.board), msg.name);
      reply(ack, result);
      if (result.ok) sendInfo();
    });
  });

  const shutdown = () => { store.shutdown(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return store;
}

module.exports = { setup };
