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

  const shutdown = () => { store.flushDrafts(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return store;
}

module.exports = { setup };
