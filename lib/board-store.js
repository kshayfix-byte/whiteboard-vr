// Server-side board storage.
//
// Live boards are kept in memory, so everyone in a room (including people who
// join late) sees the current drawing. A board is only written to disk when
// someone presses Save (or Save all). Each new board gets a temporary name like
// "Whiteboard_4821"; the first Save asks for a real name.
//
// One JSON file per room in DATA_DIR (default ./data), holding the last saved
// version of each board in that room:
// {
//   "version": 2,
//   "room": "AB12C",
//   "boards": {
//     "main": {
//       "id": "main",
//       "name": "Weekly planning",
//       "named": true,                  // saved at least once with a chosen name
//       "createdAt": "...", "savedAt": "...",
//       "width": 1500, "height": 1000,  // canvas size in pixels
//       "shape": "flat",                // later: "cylinder" for 360 boards
//       "background": "#EEF8FD",
//       "ops": [ { "type": "stroke", ... }, ... ]
//     }
//   }
// }
//
// A room can hold several boards (keyed by id) for the "add whiteboard"
// feature. "ops" is the ordered list of drawing operations since the last
// erase-all. New tools (text labels, highlighter, ...) add new op types;
// renderers skip types they don't know.

const fs = require('fs');
const path = require('path');

const DEFAULT_BOARD_ID = 'main';
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 1000;
const DEFAULT_BACKGROUND = '#EEF8FD';
const MAX_OPS_PER_BOARD = 200000;
const MAX_BOARDS_PER_ROOM = 50;
const MAX_NAME_LENGTH = 80;

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{3,8}$|^[a-zA-Z]{1,20}$/;

function isValidRoom(room) {
  return typeof room === 'string' && ROOM_PATTERN.test(room);
}

function isValidBoardId(id) {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

function normalizeRoom(room) {
  return typeof room === 'string' ? room.trim().toUpperCase() : room;
}

function boardIdOrDefault(id) {
  return isValidBoardId(id) ? id : DEFAULT_BOARD_ID;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function temporaryName() {
  return 'Whiteboard_' + String(Math.floor(1000 + Math.random() * 9000));
}

// Turn a client's draw message into a stored op, or null if it is invalid.
function strokeFromDraw(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const nums = [obj.lastX, obj.lastY, obj.x, obj.y];
  if (!nums.every(isFiniteNumber)) return null;
  const size = Number(obj.size);
  if (!isFiniteNumber(size) || size <= 0 || size > 500) return null;
  const color = typeof obj.color === 'string' && COLOR_PATTERN.test(obj.color) ? obj.color : '#000000';
  return {
    type: 'stroke',
    x0: obj.lastX,
    y0: obj.lastY,
    x1: obj.x,
    y1: obj.y,
    color: color,
    size: size,
    erase: obj.clearing === true || obj.clearing === 'true'
  };
}

function savedCopy(board) {
  return {
    id: board.id,
    name: board.name,
    named: board.named,
    createdAt: board.createdAt,
    savedAt: board.savedAt,
    width: board.width,
    height: board.height,
    shape: board.shape,
    background: board.background,
    ops: board.ops.slice()
  };
}

class BoardStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.rooms = new Map(); // room -> { room, boards: {id: liveBoard}, saved: {id: savedBoard} }
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  fileFor(room) {
    return path.join(this.dataDir, room + '.json');
  }

  readFile(room) {
    try {
      const data = JSON.parse(fs.readFileSync(this.fileFor(room), 'utf8'));
      if (data && typeof data === 'object' && data.boards && typeof data.boards === 'object') return data;
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read boards for room ' + room + ':', err.message);
    }
    return null;
  }

  newBoard(id) {
    return {
      id: id,
      name: temporaryName(),
      named: false,
      createdAt: new Date().toISOString(),
      savedAt: null,
      dirty: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      shape: 'flat',
      background: DEFAULT_BACKGROUND,
      ops: []
    };
  }

  // Load a room from memory or from its last saved version on disk.
  getRoom(room) {
    if (this.rooms.has(room)) return this.rooms.get(room);
    const data = { room: room, boards: {}, saved: {} };
    const file = this.readFile(room);
    if (file) {
      Object.keys(file.boards).forEach((id) => {
        const b = file.boards[id];
        if (!isValidBoardId(id) || !b || !Array.isArray(b.ops)) return;
        const saved = Object.assign(this.newBoard(id), b, { id: id, dirty: false });
        // Files from the first version of this PR stored the name on the room.
        if (!saved.name) saved.name = cleanName(file.name) || temporaryName();
        if (typeof saved.named !== 'boolean') saved.named = !!cleanName(file.name);
        data.saved[id] = savedCopy(saved);
        data.boards[id] = Object.assign({}, saved, { ops: saved.ops.slice() });
      });
    }
    this.rooms.set(room, data);
    return data;
  }

  // Get a live board, creating it (with a temporary name) if it doesn't exist.
  getBoard(room, boardId) {
    const data = this.getRoom(room);
    const id = boardIdOrDefault(boardId);
    if (!data.boards[id]) {
      if (Object.keys(data.boards).length >= MAX_BOARDS_PER_ROOM) return null;
      data.boards[id] = this.newBoard(id);
    }
    return data.boards[id];
  }

  // What clients need to show names and enable/disable Save all.
  roomInfo(room) {
    const data = this.getRoom(room);
    const boards = Object.keys(data.boards).map((id) => {
      const b = data.boards[id];
      return { id: id, name: b.name, named: b.named, dirty: b.dirty, savedAt: b.savedAt };
    });
    return {
      room: room,
      boards: boards,
      allNamed: boards.length > 0 && boards.every((b) => b.named)
    };
  }

  // Returns true if the board just went from saved to having unsaved changes.
  markDirty(board) {
    const wasDirty = board.dirty;
    board.dirty = true;
    return !wasDirty;
  }

  addOp(room, boardId, op) {
    const board = this.getBoard(room, boardId);
    if (!board || board.ops.length >= MAX_OPS_PER_BOARD) return { ok: false };
    board.ops.push(op);
    return { ok: true, becameDirty: this.markDirty(board) };
  }

  clearBoard(room, boardId) {
    const board = this.getBoard(room, boardId);
    if (!board) return { ok: false };
    board.ops = [];
    return { ok: true, becameDirty: this.markDirty(board) };
  }

  // Save one board. The first save needs a real name; later saves keep the
  // current name unless a new one is given.
  saveBoard(room, boardId, name) {
    const board = this.getBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    const chosen = cleanName(name);
    if (!board.named && !chosen) return { ok: false, error: 'Please give this board a name before saving.', needsName: true };
    if (chosen) board.name = chosen;
    board.named = true;
    this.commit(room, [board]);
    return { ok: true, name: board.name };
  }

  // Save every board in the room. Only allowed once each board has been
  // named through its own Save.
  saveAll(room) {
    const data = this.getRoom(room);
    const boards = Object.keys(data.boards).map((id) => data.boards[id]);
    if (!boards.length) return { ok: false, error: 'There are no boards to save.' };
    if (!boards.every((b) => b.named)) return { ok: false, error: 'Save and name each board first.' };
    this.commit(room, boards);
    return { ok: true, count: boards.length };
  }

  // Rename a board. If it has been saved before, the saved copy is renamed too.
  renameBoard(room, boardId, name) {
    const board = this.getBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    const chosen = cleanName(name);
    if (!chosen) return { ok: false, error: 'The name can’t be empty.' };
    board.name = chosen;
    const data = this.getRoom(room);
    if (data.saved[board.id]) {
      data.saved[board.id].name = chosen;
      this.writeRoom(room);
    }
    return { ok: true, name: chosen };
  }

  commit(room, boards) {
    const data = this.getRoom(room);
    const now = new Date().toISOString();
    boards.forEach((board) => {
      board.savedAt = now;
      board.dirty = false;
      data.saved[board.id] = savedCopy(board);
    });
    this.writeRoom(room);
  }

  writeRoom(room) {
    const data = this.getRoom(room);
    const file = this.fileFor(room);
    const tmp = file + '.tmp';
    const out = { version: 2, room: room, boards: data.saved };
    try {
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Could not save boards for room ' + room + ':', err.message);
    }
  }

  // Every saved board on the server, most recently saved first.
  list() {
    let files = [];
    try {
      files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      files = [];
    }
    const result = [];
    files.forEach((file) => {
      const room = file.slice(0, -5);
      if (!isValidRoom(room)) return;
      const saved = this.rooms.has(room) ? this.rooms.get(room).saved : this.getRoom(room).saved;
      Object.keys(saved).forEach((id) => {
        result.push({ room: room, board: id, name: saved[id].name, savedAt: saved[id].savedAt });
      });
    });
    return result.sort((a, b) => ((a.savedAt || '') < (b.savedAt || '') ? 1 : -1));
  }
}

module.exports = {
  BoardStore,
  DEFAULT_BOARD_ID,
  isValidRoom,
  boardIdOrDefault,
  normalizeRoom,
  strokeFromDraw,
  cleanName,
  temporaryName
};
