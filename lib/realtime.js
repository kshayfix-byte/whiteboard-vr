// Socket.io + REST wiring shared by server.js and server-ssl.js.
const path = require('path');
const express = require('express');
const {
  BoardStore,
  DEFAULT_BOARD_ID,
  isValidRoom,
  normalizeRoom,
  strokeFromDraw
} = require('./board-store');

function boardPayload(store, room, boardId) {
  const data = store.getRoom(room);
  const board = store.getBoard(room, boardId);
  return {
    room: room,
    name: data.name || '',
    board: board.id,
    width: board.width,
    height: board.height,
    shape: board.shape,
    background: board.background,
    ops: board.ops
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
    res.json(boardPayload(store, room, DEFAULT_BOARD_ID));
  });

  io.on('connection', (socket) => {
    let currentRoom = null;

    // Clients send `join` on every (re)connect and get the saved board back.
    socket.on('join', (msg) => {
      const room = normalizeRoom(msg && msg.room);
      if (!isValidRoom(room)) return;
      if (currentRoom && currentRoom !== room) socket.leave(currentRoom);
      currentRoom = room;
      socket.join(room);
      socket.emit('boardState', boardPayload(store, room, msg.board));
    });

    socket.on('draw', (obj) => {
      if (!currentRoom || !obj || normalizeRoom(obj.room) !== currentRoom) return;
      const op = strokeFromDraw(obj);
      if (!op) return;
      store.addOp(currentRoom, obj.board, op);
      socket.to(currentRoom).emit('remoteDraw', obj);
    });

    socket.on('eraseAll', (obj) => {
      if (!currentRoom || !obj || normalizeRoom(obj.room) !== currentRoom) return;
      store.clearBoard(currentRoom, obj.board);
      socket.to(currentRoom).emit('remoteEraseAll', obj);
    });

    socket.on('rename', (msg) => {
      if (!currentRoom || !msg || normalizeRoom(msg.room) !== currentRoom) return;
      const name = store.setName(currentRoom, msg.name);
      io.to(currentRoom).emit('boardRenamed', { room: currentRoom, name: name });
    });
  });

  const flush = () => store.flushAll();
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });

  return store;
}

module.exports = { setup };
