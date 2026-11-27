// Server-side board storage.
//
// Each room is saved as one JSON file in DATA_DIR (default ./data).
// A room holds one or more boards keyed by board id; today the clients only
// use the "main" board, but the shape is ready for several boards per room.
//
// File shape (version 1):
// {
//   "version": 1,
//   "room": "AB12C",
//   "name": "Weekly planning",          // human-friendly name, optional
//   "createdAt": "...", "updatedAt": "...",
//   "boards": {
//     "main": {
//       "id": "main",
//       "width": 1500, "height": 1000,  // canvas size in pixels
//       "shape": "flat",                // later: "cylinder" for 360 boards
//       "background": "#EEF8FD",
//       "ops": [ { "type": "stroke", ... }, ... ]
//     }
//   }
// }
//
// "ops" is the ordered list of drawing operations since the last erase-all.
// New tools (text labels, highlighter, ...) add new op types; renderers skip
// types they don't know, so older clients won't break.

const fs = require('fs');
const path = require('path');

const DEFAULT_BOARD_ID = 'main';
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 1000;
const DEFAULT_BACKGROUND = '#EEF8FD';
const MAX_OPS_PER_BOARD = 200000;
const MAX_NAME_LENGTH = 80;
const SAVE_DELAY_MS = 1000;

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{3,8}$|^[a-zA-Z]{1,20}$/;

function isValidRoom(room) {
  return typeof room === 'string' && ROOM_PATTERN.test(room);
}

function normalizeRoom(room) {
  return typeof room === 'string' ? room.trim().toUpperCase() : room;
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function cleanName(name) {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
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

class BoardStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.rooms = new Map();
    this.timers = new Map();
    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  fileFor(room) {
    return path.join(this.dataDir, room + '.json');
  }

  newRoom(room) {
    const now = new Date().toISOString();
    return {
      version: 1,
      room: room,
      name: '',
      createdAt: now,
      updatedAt: now,
      boards: {}
    };
  }

  newBoard(id) {
    return {
      id: id,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      shape: 'flat',
      background: DEFAULT_BACKGROUND,
      ops: []
    };
  }

  // Load a room from memory or disk. Creates an empty one if missing.
  getRoom(room) {
    if (this.rooms.has(room)) return this.rooms.get(room);
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(this.fileFor(room), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Could not read board for room ' + room + ':', err.message);
    }
    if (!data || typeof data !== 'object' || !data.boards) data = this.newRoom(room);
    this.rooms.set(room, data);
    return data;
  }

  getBoard(room, boardId) {
    const data = this.getRoom(room);
    const id = boardId || DEFAULT_BOARD_ID;
    if (!data.boards[id]) data.boards[id] = this.newBoard(id);
    return data.boards[id];
  }

  hasContent(data) {
    return !!data.name || Object.keys(data.boards).some((id) => data.boards[id].ops.length > 0);
  }

  touch(room) {
    const data = this.getRoom(room);
    data.updatedAt = new Date().toISOString();
    this.scheduleSave(room);
  }

  addOp(room, boardId, op) {
    const board = this.getBoard(room, boardId);
    if (board.ops.length >= MAX_OPS_PER_BOARD) return false;
    board.ops.push(op);
    this.touch(room);
    return true;
  }

  clearBoard(room, boardId) {
    const board = this.getBoard(room, boardId);
    board.ops = [];
    this.touch(room);
  }

  setName(room, name) {
    const data = this.getRoom(room);
    data.name = cleanName(name);
    this.touch(room);
    return data.name;
  }

  // Short summary of every saved room, newest first.
  list() {
    const summaries = new Map();
    let files = [];
    try {
      files = fs.readdirSync(this.dataDir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      files = [];
    }
    files.forEach((file) => {
      const room = file.slice(0, -5);
      if (!isValidRoom(room)) return;
      try {
        const data = this.rooms.get(room) || JSON.parse(fs.readFileSync(path.join(this.dataDir, file), 'utf8'));
        summaries.set(room, this.summary(data));
      } catch (err) {
        // skip unreadable files
      }
    });
    this.rooms.forEach((data, room) => {
      if (this.hasContent(data)) summaries.set(room, this.summary(data));
    });
    return Array.from(summaries.values()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  summary(data) {
    return {
      room: data.room,
      name: data.name || '',
      updatedAt: data.updatedAt,
      boards: Object.keys(data.boards).length
    };
  }

  scheduleSave(room) {
    if (this.timers.has(room)) return;
    this.timers.set(room, setTimeout(() => {
      this.timers.delete(room);
      this.saveNow(room);
    }, SAVE_DELAY_MS));
  }

  saveNow(room) {
    const data = this.rooms.get(room);
    if (!data || !this.hasContent(data)) return;
    const file = this.fileFor(room);
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('Could not save board for room ' + room + ':', err.message);
    }
  }

  flushAll() {
    this.timers.forEach((timer, room) => {
      clearTimeout(timer);
      this.saveNow(room);
    });
    this.timers.clear();
  }
}

module.exports = {
  BoardStore,
  DEFAULT_BOARD_ID,
  isValidRoom,
  normalizeRoom,
  strokeFromDraw,
  cleanName
};
