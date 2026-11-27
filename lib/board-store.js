// Server-side board storage.
//
// Live boards are kept in memory, so everyone in a room (including people who
// join late) sees the current drawing. Each new board gets a temporary name
// like "Whiteboard_4821".
//
// Saving:
// - A board is written to its saved file (DATA_DIR/<room>.json) when someone
//   presses Save (or Save all). The first Save asks for a real name.
// - Once a board has been saved, later changes are autosaved to that same
//   saved file a few seconds after they happen.
//
// Backup copy (only for boards that have never been saved):
// - Every few seconds their unsaved changes are written to
//   DATA_DIR/drafts/<room>.json.
// - When the server starts, any leftover backups are moved to
//   DATA_DIR/recovery/ and offered to the user, by name and last-change time,
//   to restore one by one or all at once (or discard).
// - A marker file (DATA_DIR/.running) tells whether the last shutdown was
//   clean.
//
// Saved file shape (version 2):
// {
//   "version": 2,
//   "room": "AB12C",
//   "boards": {
//     "main": {
//       "id": "main",
//       "name": "Weekly planning",
//       "named": true,                  // saved at least once with a chosen name
//       "createdAt": "...", "savedAt": "...", "modifiedAt": "...",
//       "width": 1500, "height": 1000,  // canvas size in pixels; 1000 px = 1 m
//                                       // in VR, so this board is 1.5 m x 1 m
//       "shape": "flat",                // or "cylinder": a 360-degree board you
//                                       // stand inside (fixed size, see WRAP_*)
//       "pose": null,                   // place in VR: null = automatic layout,
//                                       // or {position:[x,y,z], rotationY} once
//                                       // someone moves the board (metres and
//                                       // degrees, world coordinates)
//       "background": "#EEF8FD",
//       "ops": [ { "type": "stroke", ... }, ... ]
//     }
//   }
// }
//
// A room can hold several boards (keyed by id). The first one is "main";
// "Add whiteboard" creates more with random ids. Boards are listed in the
// order they were created (createdAt), which is also their place in VR. "ops" is the ordered list of drawing operations since the last
// erase-all. New tools (text labels, highlighter, ...) add new op types;
// renderers skip types they don't know.

const fs = require('fs');
const path = require('path');

const DEFAULT_BOARD_ID = 'main';
const DEFAULT_WIDTH = 1500;
const DEFAULT_HEIGHT = 1000;
const DEFAULT_BACKGROUND = '#EEF8FD';
// Board size. Every board uses the same pixel density (1000 px per metre in
// VR, which is also what the pen sizes assume), so a bigger board means more
// pixels, not bigger pixels. Flat boards can be 0.5-4 m wide and 0.5-2.5 m
// high. 360-degree ("cylinder") boards have a fixed size: WRAP_WIDTH px
// all the way round by WRAP_HEIGHT px. Files with sizes past MAX_CANVAS_SIDE
// fall back to the default.
const PX_PER_METRE = 1000;
const MIN_SIDE = 500;
const MAX_FLAT_WIDTH = 4000;
const MAX_FLAT_HEIGHT = 2500;
const MAX_CANVAS_SIDE = 8192;
const WRAP_WIDTH = 8000;    // 8 m round, so the wall is about 1.27 m from the middle
const WRAP_HEIGHT = 1800;   // kept in step with src/board-client.js
const MAX_OPS_PER_BOARD = 200000;
const MAX_BOARDS_PER_ROOM = 50;
const MAX_NAME_LENGTH = 80;
const WRITE_DELAY_MS = 3000;

const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const RECOVERY_ID_PATTERN = /^[A-Za-z0-9_.-]{1,120}$/;
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

function randomBoardId() {
  return 'b' + Math.random().toString(36).substr(2, 6);
}

function randomRoom() {
  return Math.random().toString(36).substr(2, 5).toUpperCase();
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

function cleanShape(shape) {
  return shape === 'cylinder' ? 'cylinder' : 'flat';
}

// Give a board the right shape name and, for 360-degree boards, their size.
function fixShape(board) {
  board.shape = cleanShape(board.shape);
  if (board.shape === 'cylinder') {
    board.width = WRAP_WIDTH;
    board.height = WRAP_HEIGHT;
  }
  return board;
}

function isValidSize(width, height) {
  return Number.isInteger(width) && Number.isInteger(height) &&
    width >= MIN_SIDE && height >= MIN_SIDE &&
    width <= MAX_CANVAS_SIDE && height <= MAX_CANVAS_SIDE;
}

// Where a moved board is in VR (see cleanPose). Boards stay within
// POSE_MAX_DISTANCE metres of the middle of the room, and between the floor
// and POSE_MAX_HEIGHT.
const POSE_MAX_DISTANCE = 30;
const POSE_MAX_HEIGHT = 10;

// A pose sent by a client or read from a file: { position: [x, y, z],
// rotationY } in metres and degrees. Returns a cleaned copy (position to the
// millimetre, rotation 0-360 to a tenth of a degree, kept inside the room),
// or null for "automatic layout" (null, missing or unusable values).
function cleanPose(pose) {
  if (!pose || typeof pose !== 'object' || !Array.isArray(pose.position) || pose.position.length !== 3) return null;
  let [x, y, z] = pose.position.map(Number);
  if (![x, y, z].every(isFiniteNumber)) return null;
  const dist = Math.sqrt(x * x + z * z);
  if (dist > POSE_MAX_DISTANCE) {
    x = x * POSE_MAX_DISTANCE / dist;
    z = z * POSE_MAX_DISTANCE / dist;
  }
  y = Math.min(POSE_MAX_HEIGHT, Math.max(0, y));
  let r = Number(pose.rotationY);
  if (!isFiniteNumber(r)) r = 0;
  r = Math.round((((r % 360) + 360) % 360) * 10) / 10;
  if (r >= 360) r = 0;
  const mm = (n) => Math.round(n * 1000) / 1000;
  return { position: [mm(x), mm(y), mm(z)], rotationY: r };
}

function samePose(a, b) {
  if (!a || !b) return a === b;
  return a.rotationY === b.rotationY && a.position.every((n, i) => n === b.position[i]);
}

// Size a user asked for (flat board), rounded to whole centimetres, or null.
function cleanFlatSize(width, height) {
  width = Math.round(Number(width) / 10) * 10;
  height = Math.round(Number(height) / 10) * 10;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width < MIN_SIDE || height < MIN_SIDE || width > MAX_FLAT_WIDTH || height > MAX_FLAT_HEIGHT) return null;
  return { width: width, height: height };
}

// Move an op by (dx, dy) pixels. Used when a board is resized around its
// centre. New op types with a position should use x/y (and x0/y0, x1/y1 for
// two points) so they move along too.
function shiftOp(op, dx, dy) {
  const out = Object.assign({}, op);
  ['x', 'x0', 'x1'].forEach((k) => { if (isFiniteNumber(out[k])) out[k] += dx; });
  ['y', 'y0', 'y1'].forEach((k) => { if (isFiniteNumber(out[k])) out[k] += dy; });
  if (Array.isArray(out.points)) {
    out.points = out.points.map((p) => (Array.isArray(p) && p.length >= 2 ? [p[0] + dx, p[1] + dy].concat(p.slice(2)) : p));
  }
  return out;
}

function savedCopy(board) {
  return {
    id: board.id,
    name: board.name,
    named: board.named,
    createdAt: board.createdAt,
    savedAt: board.savedAt,
    modifiedAt: board.modifiedAt,
    width: board.width,
    height: board.height,
    shape: board.shape,
    pose: board.pose || null,
    background: board.background,
    ops: board.ops.slice()
  };
}

function readJson(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && typeof data === 'object' && data.boards && typeof data.boards === 'object') return data;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Could not read ' + file + ':', err.message);
  }
  return null;
}

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

class BoardStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.draftsDir = path.join(dataDir, 'drafts');
    this.recoveryDir = path.join(dataDir, 'recovery');
    this.removedDir = path.join(dataDir, 'removed');
    this.markerFile = path.join(dataDir, '.running');
    this.rooms = new Map(); // room -> { room, boards: {id: liveBoard}, saved: {id: savedBoard} }
    this.timers = new Map();
    fs.mkdirSync(this.draftsDir, { recursive: true });
    fs.mkdirSync(this.recoveryDir, { recursive: true });
    fs.mkdirSync(this.removedDir, { recursive: true });

    // If the marker is still there, the server didn't shut down cleanly.
    this.uncleanShutdown = fs.existsSync(this.markerFile);
    fs.writeFileSync(this.markerFile, new Date().toISOString());
    this.collectLeftoverBackups();
  }

  fileFor(room) {
    return path.join(this.dataDir, room + '.json');
  }

  draftFor(room) {
    return path.join(this.draftsDir, room + '.json');
  }

  // Move backups left by the previous run into the recovery folder, one file
  // per board, so they can be restored or discarded individually.
  collectLeftoverBackups() {
    let files = [];
    try {
      files = fs.readdirSync(this.draftsDir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      return;
    }
    const stamp = Date.now();
    files.forEach((file) => {
      const full = path.join(this.draftsDir, file);
      const draft = readJson(full);
      const room = file.slice(0, -5);
      if (draft && isValidRoom(room)) {
        Object.keys(draft.boards).forEach((id) => {
          const b = draft.boards[id];
          if (!isValidBoardId(id) || !b || !Array.isArray(b.ops)) return;
          const entry = {
            version: 2,
            room: room,
            boards: { [id]: Object.assign(b, { modifiedAt: b.modifiedAt || draft.writtenAt || null }) }
          };
          try {
            writeJsonAtomic(path.join(this.recoveryDir, room + '.' + id + '.' + stamp + '.json'), entry);
          } catch (err) {
            console.error('Could not keep backup for room ' + room + ':', err.message);
          }
        });
      }
      try { fs.unlinkSync(full); } catch (err) { /* ignore */ }
    });
  }

  newBoard(id) {
    const now = new Date().toISOString();
    return {
      id: id,
      name: temporaryName(),
      named: false,
      createdAt: now,
      savedAt: null,
      modifiedAt: now,
      dirty: false,
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      shape: 'flat',
      pose: null,
      background: DEFAULT_BACKGROUND,
      ops: []
    };
  }

  // Load a room from memory or from its saved file on disk.
  getRoom(room) {
    if (this.rooms.has(room)) return this.rooms.get(room);
    const data = { room: room, boards: {}, saved: {} };
    const file = readJson(this.fileFor(room));
    if (file) {
      Object.keys(file.boards).forEach((id) => {
        const b = file.boards[id];
        if (!isValidBoardId(id) || !b || !Array.isArray(b.ops)) return;
        const saved = Object.assign(this.newBoard(id), b, { id: id, dirty: false });
        // Files from the first version of this PR stored the name on the room.
        if (!saved.name) saved.name = cleanName(file.name) || temporaryName();
        if (typeof saved.named !== 'boolean') saved.named = true;
        if (!saved.modifiedAt) saved.modifiedAt = saved.savedAt;
        if (!isValidSize(saved.width, saved.height)) {
          saved.width = DEFAULT_WIDTH;
          saved.height = DEFAULT_HEIGHT;
        }
        saved.pose = cleanPose(saved.pose); // older files have none
        fixShape(saved);
        data.saved[id] = savedCopy(saved);
        data.boards[id] = Object.assign({}, saved, { ops: saved.ops.slice() });
      });
    }
    this.rooms.set(room, data);
    return data;
  }

  // A live board, or null if the room has no board with that id.
  findBoard(room, boardId) {
    return this.getRoom(room).boards[boardIdOrDefault(boardId)] || null;
  }

  // Boards of a room in creation order (oldest first).
  boardList(room) {
    const boards = this.getRoom(room).boards;
    return Object.keys(boards).map((id) => boards[id]).sort((a, b) => {
      const ta = a.createdAt || '';
      const tb = b.createdAt || '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      if (a.id === DEFAULT_BOARD_ID) return -1;
      if (b.id === DEFAULT_BOARD_ID) return 1;
      return a.id < b.id ? -1 : 1;
    });
  }

  // Make sure a room has at least one board (the default "main" board).
  ensureBoard(room) {
    const list = this.boardList(room);
    return list.length ? list : [this.getBoard(room, DEFAULT_BOARD_ID)];
  }

  // "Add whiteboard": a new empty board with a temporary name. `shape` is
  // "cylinder" for a 360-degree board, otherwise it is flat.
  addBoard(room, shape) {
    const data = this.getRoom(room);
    if (Object.keys(data.boards).length >= MAX_BOARDS_PER_ROOM) {
      return { ok: false, error: 'This room already has the most whiteboards allowed (' + MAX_BOARDS_PER_ROOM + ').' };
    }
    let id;
    do { id = randomBoardId(); } while (data.boards[id] || data.saved[id]);
    const board = this.getBoard(room, id);
    // Keep creation order strict even when two boards are added in the same millisecond.
    const last = this.boardList(room).filter((b) => b !== board).pop();
    if (last && last.createdAt && board.createdAt <= last.createdAt) {
      board.createdAt = new Date(Date.parse(last.createdAt) + 1).toISOString();
    }
    board.shape = cleanShape(shape);
    fixShape(board);
    return { ok: true, board: board.id, name: board.name, shape: board.shape };
  }

  // "Remove whiteboard": take a board out of the room and out of its saved
  // file. A copy is kept in DATA_DIR/removed/ so a mistake can be undone by
  // hand. The last board of a room can't be removed.
  removeBoard(room, boardId) {
    const data = this.getRoom(room);
    const board = this.findBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    if (Object.keys(data.boards).length <= 1) {
      return { ok: false, error: 'This is the only whiteboard in the room, so it can’t be removed.' };
    }
    const keep = { version: 2, room: room, removedAt: new Date().toISOString(), boards: { [board.id]: savedCopy(board) } };
    try {
      writeJsonAtomic(path.join(this.removedDir, room + '.' + board.id + '.' + Date.now() + '.json'), keep);
    } catch (err) {
      console.error('Could not keep a copy of removed board ' + board.id + ':', err.message);
      return { ok: false, error: 'Could not remove the whiteboard (no copy could be kept).' };
    }
    const wasSaved = !!data.saved[board.id];
    delete data.boards[board.id];
    delete data.saved[board.id];
    if (wasSaved) this.writeRoom(room);
    this.writeDraft(room);
    return { ok: true, board: board.id, name: board.name };
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
    const boards = this.boardList(room).map((b) => {
      const id = b.id;
      return {
        id: id, name: b.name, named: b.named, dirty: b.dirty,
        restored: !!b.restored, savedAt: b.savedAt, modifiedAt: b.modifiedAt,
        createdAt: b.createdAt, width: b.width, height: b.height, shape: b.shape,
        pose: b.pose || null
      };
    });
    return {
      room: room,
      boards: boards,
      allNamed: boards.length > 0 && boards.every((b) => b.named)
    };
  }

  // Record a change. Named boards autosave to their saved file; unnamed
  // boards get a backup copy. Returns true if the board just became dirty.
  changed(room, board) {
    const wasDirty = board.dirty;
    board.dirty = true;
    board.modifiedAt = new Date().toISOString();
    this.scheduleWrite(room);
    return !wasDirty;
  }

  addOp(room, boardId, op) {
    const board = this.findBoard(room, boardId);
    if (!board || board.ops.length >= MAX_OPS_PER_BOARD) return { ok: false };
    board.ops.push(op);
    return { ok: true, becameDirty: this.changed(room, board) };
  }

  clearBoard(room, boardId) {
    const board = this.findBoard(room, boardId);
    if (!board) return { ok: false };
    board.ops = [];
    return { ok: true, becameDirty: this.changed(room, board) };
  }

  // Change a board's size. Drawings keep their size and stay centred: the
  // board grows (or shrinks) evenly on all sides. Shrinking only hides what
  // falls outside the new edge; it comes back if the board is enlarged again.
  resizeBoard(room, boardId, width, height) {
    const board = this.findBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    if (board.shape === 'cylinder') return { ok: false, error: '360° boards have a fixed size and can’t be resized.' };
    const size = cleanFlatSize(width, height);
    if (!size) {
      return {
        ok: false,
        error: 'Board size must be ' + (MIN_SIDE / PX_PER_METRE) + '–' + (MAX_FLAT_WIDTH / PX_PER_METRE) + ' m wide and ' +
          (MIN_SIDE / PX_PER_METRE) + '–' + (MAX_FLAT_HEIGHT / PX_PER_METRE) + ' m high.'
      };
    }
    if (size.width === board.width && size.height === board.height) {
      return { ok: true, unchanged: true, width: board.width, height: board.height };
    }
    const dx = Math.round((size.width - board.width) / 2);
    const dy = Math.round((size.height - board.height) / 2);
    board.ops = board.ops.map((op) => shiftOp(op, dx, dy));
    board.width = size.width;
    board.height = size.height;
    return { ok: true, width: board.width, height: board.height, becameDirty: this.changed(room, board) };
  }

  // Move a board in VR, or put it back in the automatic layout (pose null).
  // Saved like any other change.
  setBoardPose(room, boardId, pose) {
    const board = this.findBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    if (pose !== null && pose !== undefined && !cleanPose(pose)) return { ok: false, error: 'That is not a valid place for a board.' };
    const clean = cleanPose(pose);
    if (samePose(clean, board.pose || null)) return { ok: true, unchanged: true, pose: clean };
    board.pose = clean;
    return { ok: true, pose: clean, becameDirty: this.changed(room, board) };
  }

  // Save one board. The first save needs a real name; later saves keep the
  // current name unless a new one is given.
  saveBoard(room, boardId, name) {
    const board = this.findBoard(room, boardId);
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

  // Rename a board. A saved board's saved file is updated right away.
  renameBoard(room, boardId, name) {
    const board = this.findBoard(room, boardId);
    if (!board) return { ok: false, error: 'Board not found.' };
    const chosen = cleanName(name);
    if (!chosen) return { ok: false, error: 'The name can’t be empty.' };
    board.name = chosen;
    const data = this.getRoom(room);
    if (data.saved[board.id]) {
      data.saved[board.id].name = chosen;
      this.writeRoom(room);
    } else {
      this.scheduleWrite(room);
    }
    return { ok: true, name: chosen };
  }

  commit(room, boards) {
    const data = this.getRoom(room);
    const now = new Date().toISOString();
    boards.forEach((board) => {
      board.savedAt = now;
      board.dirty = false;
      board.restored = false;
      data.saved[board.id] = savedCopy(board);
    });
    this.writeRoom(room);
    this.writeDraft(room);
  }

  scheduleWrite(room) {
    if (this.timers.has(room)) return;
    this.timers.set(room, setTimeout(() => {
      this.timers.delete(room);
      this.flushRoom(room);
    }, WRITE_DELAY_MS));
  }

  // Autosave named boards with changes; back up unnamed ones.
  // Returns the ids of boards that were autosaved.
  flushRoom(room) {
    const data = this.rooms.get(room);
    if (!data) return [];
    const toSave = Object.keys(data.boards)
      .map((id) => data.boards[id])
      .filter((b) => b.named && b.dirty);
    if (toSave.length) this.commit(room, toSave);
    else this.writeDraft(room);
    if (toSave.length && this.onAutosave) this.onAutosave(room);
    return toSave.map((b) => b.id);
  }

  writeRoom(room) {
    const data = this.getRoom(room);
    try {
      writeJsonAtomic(this.fileFor(room), { version: 2, room: room, boards: data.saved });
    } catch (err) {
      console.error('Could not save boards for room ' + room + ':', err.message);
    }
  }

  // Back up every never-saved board that has content, or remove the backup
  // when there is none.
  writeDraft(room) {
    const data = this.rooms.get(room);
    if (!data) return;
    const file = this.draftFor(room);
    const unsaved = {};
    Object.keys(data.boards).forEach((id) => {
      const b = data.boards[id];
      if (!b.named && b.dirty && b.ops.length) unsaved[id] = savedCopy(b);
    });
    try {
      if (!Object.keys(unsaved).length) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        return;
      }
      writeJsonAtomic(file, { version: 2, room: room, writtenAt: new Date().toISOString(), boards: unsaved });
    } catch (err) {
      console.error('Could not write backup for room ' + room + ':', err.message);
    }
  }

  // Write everything pending right away and mark a clean shutdown.
  shutdown() {
    this.timers.forEach((timer, room) => {
      clearTimeout(timer);
      this.flushRoom(room);
    });
    this.timers.clear();
    try { fs.unlinkSync(this.markerFile); } catch (err) { /* ignore */ }
  }

  // ---- Recovery of unsaved boards from a previous run ----

  recoveryItems() {
    let files = [];
    try {
      files = fs.readdirSync(this.recoveryDir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      files = [];
    }
    const items = [];
    files.forEach((file) => {
      const entry = readJson(path.join(this.recoveryDir, file));
      if (!entry || !isValidRoom(entry.room)) return;
      const id = Object.keys(entry.boards)[0];
      const b = entry.boards[id];
      if (!b || !Array.isArray(b.ops)) return;
      items.push({
        id: file.slice(0, -5),
        room: entry.room,
        board: id,
        name: cleanName(b.name) || 'Untitled whiteboard',
        modifiedAt: b.modifiedAt || null,
        strokes: b.ops.length
      });
    });
    return items.sort((a, b) => ((a.modifiedAt || '') < (b.modifiedAt || '') ? 1 : -1));
  }

  recoveryInfo() {
    return { uncleanShutdown: this.uncleanShutdown, items: this.recoveryItems() };
  }

  recoveryFile(id) {
    if (typeof id !== 'string' || !RECOVERY_ID_PATTERN.test(id) || id.indexOf('..') !== -1) return null;
    return path.join(this.recoveryDir, id + '.json');
  }

  // Put a recovered board back into its old room. If that board id is taken
  // by a board with content, it comes back as an extra whiteboard in the same
  // room; only a full room sends it to a new room. Nothing is overwritten.
  restore(id) {
    const file = this.recoveryFile(id);
    const entry = file && readJson(file);
    if (!entry) return { ok: false, id: id, error: 'Not found.' };
    let boardId = Object.keys(entry.boards)[0];
    const b = entry.boards[boardId];
    let room = entry.room;
    const existing = this.getRoom(room).boards[boardId];
    if (existing && (existing.ops.length || existing.named)) {
      const added = this.addBoard(room);
      if (added.ok) {
        boardId = added.board;
      } else {
        do { room = randomRoom(); } while (fs.existsSync(this.fileFor(room)) || this.rooms.has(room));
      }
    }
    const board = this.getBoard(room, boardId);
    Object.assign(board, {
      name: cleanName(b.name) || board.name,
      named: false,
      createdAt: (boardId === Object.keys(entry.boards)[0] && b.createdAt) || board.createdAt,
      modifiedAt: b.modifiedAt || board.modifiedAt,
      width: isValidSize(b.width, b.height) ? b.width : board.width,
      height: isValidSize(b.width, b.height) ? b.height : board.height,
      shape: b.shape || board.shape,
      pose: cleanPose(b.pose),
      background: b.background || board.background,
      ops: b.ops.slice(),
      dirty: true,
      restored: true
    });
    fixShape(board);
    this.writeDraft(room);
    try { fs.unlinkSync(file); } catch (err) { /* ignore */ }
    return { ok: true, id: id, room: room, board: boardId, name: board.name, movedRoom: room !== entry.room };
  }

  discard(id) {
    const file = this.recoveryFile(id);
    if (!file || !fs.existsSync(file)) return { ok: false, id: id, error: 'Not found.' };
    try { fs.unlinkSync(file); } catch (err) { return { ok: false, id: id, error: err.message }; }
    return { ok: true, id: id };
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
      const saved = this.getRoom(room).saved;
      Object.keys(saved).forEach((id) => {
        result.push({ room: room, board: id, name: saved[id].name, savedAt: saved[id].savedAt, modifiedAt: saved[id].modifiedAt });
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
  cleanFlatSize,
  cleanShape,
  WRAP_WIDTH,
  WRAP_HEIGHT,
  cleanPose,
  shiftOp,
  temporaryName
};
