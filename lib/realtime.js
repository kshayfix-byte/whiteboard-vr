// Socket.io + REST wiring used by server.js (its http and https servers).
const path = require('path');
const express = require('express');
const {
  BoardStore,
  isValidRoom,
  boardIdOrDefault,
  normalizeRoom,
  strokeFromDraw,
  shiftOp
} = require('./board-store');

function boardPayload(store, room, boardId) {
  const board = store.findBoard(room, boardId);
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
    pose: board.pose || null,
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
    // Optional: `names` {recoveryId: name} renames boards as they come back
    // (the pencil in the dialog); `save: true` also saves them under that
    // name ("Save selected"), so they don't need a separate Save.
    const names = (req.body && req.body.names && typeof req.body.names === 'object') ? req.body.names : {};
    const save = !!(req.body && req.body.save === true);
    const results = ids.map((id) => {
      let result = store.restore(id);
      if (result.ok) {
        const name = typeof names[id] === 'string' ? names[id] : '';
        if (save) {
          const saved = store.saveBoard(result.room, result.board, name || result.name);
          result = Object.assign({}, result, { saved: saved.ok, name: saved.ok ? saved.name : result.name });
          if (!saved.ok) result.error = saved.error;
        } else if (name) {
          const renamed = store.renameBoard(result.room, result.board, name);
          if (renamed.ok) result = Object.assign({}, result, { name: renamed.name });
        }
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

    // Clients send `join` on every (re)connect and get every board of the
    // room back, one `boardState` each (oldest first). A new room starts with
    // one board. `infoOnly: true` (the naming pop-up) skips the drawings.
    socket.on('join', (msg) => {
      const room = normalizeRoom(msg && msg.room);
      if (!isValidRoom(room)) return;
      if (currentRoom && currentRoom !== room) socket.leave(currentRoom);
      currentRoom = room;
      socket.join(room);
      const boards = store.ensureBoard(room);
      if (!msg.infoOnly) {
        boards.forEach((b) => {
          const payload = boardPayload(store, room, b.id);
          if (payload) socket.emit('boardState', payload);
        });
      }
      sendInfo(); // the first board may have just been created
    });

    // "Add whiteboard": everyone in the room gets the new board, then the
    // person who asked gets its id (so they can switch to it). `shape:
    // "cylinder"` adds a 360-degree board instead of a flat one.
    socket.on('addBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.addBoard(currentRoom, msg.shape);
      if (result.ok) {
        io.to(currentRoom).emit('boardState', boardPayload(store, currentRoom, result.board));
        sendInfo();
      }
      reply(ack, result);
    });

    socket.on('draw', (obj) => {
      if (!inRoom(obj)) return;
      let op = strokeFromDraw(obj);
      if (!op) return;
      // A stroke drawn just before a resize reached this client was made on
      // the old size (bw x bh); move it the same way the resize moved the rest.
      const board = store.findBoard(currentRoom, obj.board);
      if (board && Number.isInteger(obj.bw) && Number.isInteger(obj.bh) &&
          (obj.bw !== board.width || obj.bh !== board.height)) {
        const dx = Math.round((board.width - obj.bw) / 2);
        const dy = Math.round((board.height - obj.bh) / 2);
        op = shiftOp(op, dx, dy);
        obj = Object.assign({}, obj, {
          lastX: obj.lastX + dx, x: obj.x + dx, lastY: obj.lastY + dy, y: obj.y + dy,
          bw: board.width, bh: board.height
        });
      }
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

    // "Remove whiteboard" (the buttons ask for three clicks first).
    socket.on('removeBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.removeBoard(currentRoom, boardIdOrDefault(msg.board));
      if (result.ok) {
        io.to(currentRoom).emit('boardRemoved', { room: currentRoom, board: result.board, name: result.name });
        sendInfo();
      }
      reply(ack, result);
    });

    // "Board size": everyone gets the resized board redrawn.
    socket.on('resizeBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const result = store.resizeBoard(currentRoom, boardIdOrDefault(msg.board), msg.width, msg.height);
      if (result.ok && !result.unchanged) {
        io.to(currentRoom).emit('boardState', boardPayload(store, currentRoom, boardIdOrDefault(msg.board)));
        sendInfo();
      }
      reply(ack, result);
    });

    // A board was moved (or put back in the automatic layout with pose null).
    // While someone drags a board their page sends `live: true` a few times a
    // second; the others see it move. The last message (`live: false`) also
    // updates everyone's board list, which carries the pose too.
    socket.on('moveBoard', (msg, ack) => {
      if (!inRoom(msg)) return reply(ack, { ok: false, error: 'Not connected to this room.' });
      const boardId = boardIdOrDefault(msg.board);
      const result = store.setBoardPose(currentRoom, boardId, msg.pose);
      if (result.ok && !result.unchanged) {
        socket.to(currentRoom).emit('boardPose', { room: currentRoom, board: boardId, pose: result.pose });
      }
      if (result.ok && (!msg.live || result.becameDirty)) sendInfo();
      reply(ack, result);
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
