import io from 'socket.io-client';
import {
    DEFAULT_BACKGROUND, normalizeRoom, clearCanvas, drawSegment, replayBoard,
    exportFilename, downloadCanvas, formatDate,
    BOARD_SIZES, SIZE_LIMITS, PX_PER_METRE, DEFAULT_WIDTH, DEFAULT_HEIGHT,
    describeSize, presetFor, metres, sizeCanvas
} from './board-client';
import { createSaveControls } from './save-controls';
import { createRecoveryUI } from './recovery-ui';
import { createMultiClick } from './triple-click';

function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

let room = normalizeRoom(getParameterByName('room'));
if (room) {
    const vrButton = document.getElementById('vr-button');
    vrButton.href = "vr.html?room="+room;
    const roomNumber = document.getElementById('room-number');
    roomNumber.textContent = room;
} else {
    room = Math.random().toString(36).substr(2, 5).toUpperCase();
    window.location.href = "index.html?room="+room;
}
 
const socket = io();

let id = Math.floor(Math.random() * 100000000);
let lastX = null;
let lastY = null;
let color = "#000000";
let size = 10;
let clearing = false;

// Every whiteboard in the room has its own canvas; only the current one is
// shown. boards[boardId] = { canvas, context2D, background, loaded }.
const boards = {};
const canvasHolder = document.getElementById('canvas-holder');
const tabList = document.getElementById('board-tab-list');
let boardOrder = [];            // ids, oldest first (from roomInfo)
let roomBoards = [];            // roomInfo.boards
let wantedBoard = getParameterByName('board'); // from the URL, if any
let boardId = null;             // the board shown and drawn on
let boardName = '';
let canvas = null;              // current board's canvas
let context2D = null;

const controls = createSaveControls({
    socket: socket,
    room: room,
    boardId: wantedBoard || 'main',
    elements: {
        name: document.getElementById('board-name'),
        state: document.getElementById('board-state'),
        status: document.getElementById('save-status'),
        save: document.getElementById('save-board'),
        rename: document.getElementById('rename-board'),
        saveAll: document.getElementById('save-all')
    },
    onChange: (board) => {
        boardName = board ? board.name : '';
        document.title = (boardName ? boardName + ' - ' : '') + 'Whiteboard VR';
    }
});

function boardFor(bid, width, height) {
    if (boards[bid]) return boards[bid];
    const c = document.createElement('canvas');
    c.width = width || DEFAULT_WIDTH;
    c.height = height || DEFAULT_HEIGHT;
    c.className = 'board-canvas hidden';
    c.dataset.board = bid;
    canvasHolder.appendChild(c);
    attachDrawing(c);
    const b = { canvas: c, context2D: c.getContext('2d'), background: DEFAULT_BACKGROUND, loaded: false };
    clearCanvas(b.context2D, c, b.background);
    boards[bid] = b;
    return b;
}

// Show one board and point Save / Rename / Export / Erase at it.
function showBoard(bid) {
    if (!boards[bid]) return;
    if (bid !== boardId) { removeGuard.reset(); zoom = 1; } // only runs after load, once removeGuard exists
    boardId = bid;
    lastX = null;
    lastY = null;
    Object.keys(boards).forEach((k) => boards[k].canvas.classList.toggle('hidden', k !== bid));
    canvas = boards[bid].canvas;
    context2D = boards[bid].context2D;
    controls.setBoard(bid);
    const url = 'index.html?room=' + encodeURIComponent(room) + (bid === 'main' ? '' : '&board=' + encodeURIComponent(bid));
    if (window.history && window.history.replaceState) window.history.replaceState(null, '', url);
    document.getElementById('vr-button').href = 'vr.html?room=' + room + (bid === 'main' ? '' : '&board=' + encodeURIComponent(bid));
    renderTabs();
    updateSizeButton();
    onResize();
}

function renderTabs() {
    updateRemoveButton();
    tabList.innerHTML = '';
    boardOrder.forEach((bid) => {
        const info = roomBoards.find((b) => b.id === bid) || { name: bid };
        const tab = document.createElement('button');
        tab.className = 'board-tab' + (bid === boardId ? ' active' : '') +
            (info.named === false ? ' temporary' : '') + (info.dirty && info.named === false ? ' unsaved' : '');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', bid === boardId ? 'true' : 'false');
        tab.textContent = info.name;
        tab.title = info.name + (info.named === false ? ' (temporary name, not saved yet)' : '');
        tab.addEventListener('click', () => showBoard(bid));
        tabList.appendChild(tab);
    });
}

socket.on('roomInfo', (info) => {
    if (!info || info.room !== room) return;
    roomBoards = info.boards || [];
    boardOrder = roomBoards.map((b) => b.id).filter((bid) => boards[bid]);
    // First load: open the board from the URL, or the first one.
    if (!boardId && boardOrder.length) {
        showBoard(boardOrder.indexOf(wantedBoard) !== -1 ? wantedBoard : boardOrder[0]);
    } else {
        renderTabs();
    }
});

// Ask the server for the room's boards on every (re)connect.
socket.on('connect', () => {
    socket.emit('join', { room: room, board: boardId || wantedBoard || 'main' });
});

socket.on('boardState', (state) => {
    if (normalizeRoom(state.room) !== room) return;
    const b = boardFor(state.board, state.width, state.height);
    b.background = state.background || DEFAULT_BACKGROUND;
    // The board may have been resized (by anyone); resizing the canvas wipes
    // it, and the replay below redraws everything.
    const resized = sizeCanvas(b.canvas, state.width, state.height);
    replayBoard(b.context2D, b.canvas, state);
    b.loaded = true;
    if (resized && state.board === boardId) {
        lastX = null;
        lastY = null;
        onResize();
    }
    if (state.board === boardId) updateSizeButton();
});

socket.on('remoteDraw', (remoteDrawObject) => {
    if (remoteDrawObject.id != id) {
        drawRemote(remoteDrawObject);
    }
});

socket.on('remoteEraseAll', (remoteEraseAllObject) => {
    if (remoteEraseAllObject.id != id) {
        eraseAllRemote(remoteEraseAllObject);
    }
});

document.getElementById('add-board').addEventListener('click', () => {
    socket.emit('addBoard', { room: room }, (result) => {
        if (result && result.ok) {
            showBoard(result.board);
            controls.setStatus('Added “' + result.name + '”');
        } else {
            controls.setStatus((result && result.error) || 'Could not add a whiteboard.', true);
        }
    });
});

// ---- Remove whiteboard: needs three clicks in a row ----
const removeButton = document.getElementById('remove-board');
const REMOVE_LABEL = 'Remove whiteboard';
const removeGuard = createMultiClick({
    count: 3,
    onProgress: (left) => {
        removeButton.classList.add('arming');
        removeButton.textContent = 'Click ' + left + ' more time' + (left === 1 ? '' : 's') + ' to remove';
    },
    onReset: () => {
        removeButton.classList.remove('arming');
        removeButton.textContent = REMOVE_LABEL;
    },
    onConfirm: (bid) => {
        removeButton.classList.remove('arming');
        removeButton.textContent = REMOVE_LABEL;
        socket.emit('removeBoard', { room: room, board: bid }, (result) => {
            if (result && result.ok) controls.setStatus('Removed “' + result.name + '”');
            else controls.setStatus((result && result.error) || 'Could not remove the whiteboard.', true);
        });
    }
});
removeButton.addEventListener('click', () => { if (boardId) removeGuard.press(boardId); });

function updateRemoveButton() {
    const only = boardOrder.length <= 1;
    removeButton.disabled = only;
    removeButton.title = only ? 'The only whiteboard in a room can’t be removed'
        : 'Removes this whiteboard for everyone. Click three times in a row.';
}

// Someone (maybe us) removed a board: drop its canvas, and if it was open,
// move to the board before it (or the next one).
socket.on('boardRemoved', (msg) => {
    if (!msg || normalizeRoom(msg.room) !== room || !boards[msg.board]) return;
    const index = boardOrder.indexOf(msg.board);
    boards[msg.board].canvas.remove();
    delete boards[msg.board];
    boardOrder = boardOrder.filter((b) => b !== msg.board);
    if (boardId === msg.board) {
        boardId = null;
        removeGuard.reset();
        const next = boardOrder[Math.max(0, index - 1)];
        if (next) showBoard(next);
    }
    renderTabs();
});

function eraseAllRemote(eraseAllRemoteObject) {
    if (room != normalizeRoom(eraseAllRemoteObject.room)) {
        return;
    }
    const b = boards[eraseAllRemoteObject.board || 'main'];
    if (b) clearCanvas(b.context2D, b.canvas, b.background);
}

function drawRemote(remoteDrawObject) {
    if (room != normalizeRoom(remoteDrawObject.room)) {
        return;
    }
    const b = boards[remoteDrawObject.board || 'main'];
    if (b) drawSegment(b.context2D, remoteDrawObject, b.background);
}

function draw (x, y) {
    // Don't draw until the saved board has loaded, so nothing gets painted over.
    if (boardId && boards[boardId].loaded && lastX != null && lastY != null) {
        var drawObject= {};
        drawObject.id = id;
        drawObject.lastX = lastX;
        drawObject.lastY = lastY;
        drawObject.x = x;
        drawObject.y = y;
        drawObject.color = color;
        drawObject.room = room;
        drawObject.board = boardId;
        drawObject.size = Number(size);
        drawObject.clearing = clearing;
        drawObject.bw = canvas.width;   // board size this stroke was drawn on
        drawObject.bh = canvas.height;
        socket.emit('draw', drawObject);
        drawRemote(drawObject);
        lastX = x;
        lastY = y;
    }
}

// Position of a mouse/touch point in the canvas's own pixels. Uses the
// on-screen box, so it works when the page is scrolled or zoomed.
function canvasPoint(c, pageX, pageY) {
    const rect = c.getBoundingClientRect();
    const x = pageX - window.pageXOffset - rect.left;
    const y = pageY - window.pageYOffset - rect.top;
    return [
        x * (c.width / rect.width),
        y * (c.height / rect.height)
    ];
}

function attachDrawing(c) {
    c.addEventListener('mousemove', (evt) => {
        evt.preventDefault();
        const p = canvasPoint(c, evt.pageX, evt.pageY);
        draw(p[0], p[1]);
    });
    c.addEventListener('mousedown', (evt) => {
        const p = canvasPoint(c, evt.pageX, evt.pageY);
        lastX = p[0];
        lastY = p[1];
    });
    c.addEventListener('mouseup', () => {
        lastX = null;
        lastY = null;
    });
    c.addEventListener('touchstart', (evt) => {
        evt.preventDefault();
        const p = canvasPoint(c, evt.targetTouches[0].pageX, evt.targetTouches[0].pageY);
        lastX = p[0];
        lastY = p[1];
    }, false);
    c.addEventListener('touchmove', (evt) => {
        evt.preventDefault();
        const p = canvasPoint(c, evt.targetTouches[0].pageX, evt.targetTouches[0].pageY);
        draw(p[0], p[1]);
    }, true);
    c.addEventListener('touchend', (evt) => {
        evt.preventDefault();
        lastX = null;
        lastY = null;
    }, false);
    c.addEventListener('touchcancel', () => {
        lastX = null;
        lastY = null;
    });
}


const colorPicker = document.querySelector("#color-picker");

colorPicker.addEventListener("change", (evt) => {
    color = evt.target.value;
}, false);

const brushSize = document.querySelector("#brush-size");

brushSize.addEventListener("change", (evt) => {
    size = evt.target.value;
}, false);

const eraser = document.querySelector("#eraser");

eraser.addEventListener("change", (evt) => {
    clearing = evt.target.checked;
}, false);

window.addEventListener('resize', onResize)

// Zoom: 1 fits the whole board on screen (as before); bigger values make the
// board larger than the screen and the page scrolls.
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4, 6];
let zoom = 1;
const zoomInButton = document.getElementById('zoom-in');
const zoomOutButton = document.getElementById('zoom-out');
const zoomFitButton = document.getElementById('zoom-fit');

function onResize() {
    if (!canvas) return;
    const ratio = canvas.width / canvas.height; // 1.5 for the standard board
    // Size that fits the screen (the original behaviour).
    let fitWidth = document.documentElement.clientWidth * 0.94;
    let fitHeight = fitWidth / ratio;
    if (fitHeight > window.innerHeight * 0.9) {
        fitHeight = Math.max(100, window.innerHeight - 150);
        fitWidth = fitHeight * ratio;
    }
    // Stop zooming in at 2 screen pixels per board pixel.
    const maxZoom = Math.max(1, 2 * canvas.width / fitWidth);
    if (zoom > maxZoom) zoom = maxZoom;
    canvas.style.width = Math.round(fitWidth * zoom) + "px";
    canvas.style.height = Math.round(fitHeight * zoom) + "px";
    document.body.classList.toggle('zoomed', zoom > 1);
    zoomOutButton.disabled = zoom <= 1;
    zoomFitButton.disabled = zoom <= 1;
    zoomInButton.disabled = zoom >= maxZoom;
    zoomFitButton.textContent = zoom > 1 ? Math.round(zoom * 100) + '%' : 'Fit';
    zoomFitButton.title = zoom > 1 ? 'Zoomed to ' + Math.round(zoom * 100) + '%. Click to fit the whole board on screen.' : 'The whole board fits on screen';
}

// Zoom around the middle of the screen, keeping that spot in view.
function setZoom(newZoom) {
    if (!canvas || newZoom === zoom) return;
    const before = canvas.getBoundingClientRect();
    const cx = (window.innerWidth / 2 - before.left) / before.width;
    const cy = (window.innerHeight / 2 - before.top) / before.height;
    zoom = newZoom;
    onResize();
    const after = canvas.getBoundingClientRect();
    canvasHolder.scrollLeft += after.left + cx * after.width - window.innerWidth / 2;
    window.scrollBy(0, after.top + cy * after.height - window.innerHeight / 2);
}

zoomInButton.addEventListener('click', () => {
    const next = ZOOM_LEVELS.find((z) => z > zoom + 0.01);
    setZoom(next || ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
});
zoomOutButton.addEventListener('click', () => {
    const lower = ZOOM_LEVELS.filter((z) => z < zoom - 0.01);
    setZoom(lower.length ? lower[lower.length - 1] : 1);
});
zoomFitButton.addEventListener('click', () => {
    setZoom(1);
    canvasHolder.scrollLeft = 0;
    window.scrollTo(0, 0);
});

// ---- Board size ----
const sizeButton = document.getElementById('board-size');
const sizeOverlay = document.getElementById('size-overlay');
const sizePresets = document.getElementById('size-presets');
const sizeWidth = document.getElementById('size-width');
const sizeHeight = document.getElementById('size-height');
const sizeError = document.getElementById('size-error');

function updateSizeButton() {
    if (!canvas) return;
    sizeButton.textContent = 'Size: ' + describeSize(canvas.width, canvas.height);
}

function enteredSize() {
    return {
        width: Math.round(Number(sizeWidth.value) * PX_PER_METRE),
        height: Math.round(Number(sizeHeight.value) * PX_PER_METRE)
    };
}

function markPreset() {
    const entered = enteredSize();
    const match = presetFor(entered.width, entered.height);
    Array.prototype.forEach.call(sizePresets.children, (btn) => {
        btn.classList.toggle('selected', !!match && btn.dataset.size === match.id);
    });
}

BOARD_SIZES.forEach((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.size = preset.id;
    btn.textContent = preset.label + ' (' + describeSize(preset.width, preset.height) + ')';
    btn.addEventListener('click', () => {
        sizeWidth.value = metres(preset.width);
        sizeHeight.value = metres(preset.height);
        sizeError.textContent = '';
        markPreset();
    });
    sizePresets.appendChild(btn);
});
sizeWidth.addEventListener('input', markPreset);
sizeHeight.addEventListener('input', markPreset);

sizeButton.addEventListener('click', () => {
    if (!canvas) return;
    document.getElementById('size-board-name').textContent = boardName ? '“' + boardName + '”' : 'this whiteboard';
    sizeWidth.value = metres(canvas.width);
    sizeHeight.value = metres(canvas.height);
    sizeError.textContent = '';
    markPreset();
    sizeOverlay.classList.remove('hidden');
});

function closeSize() {
    sizeOverlay.classList.add('hidden');
}
document.getElementById('size-cancel').addEventListener('click', closeSize);
sizeOverlay.addEventListener('click', (e) => { if (e.target === sizeOverlay) closeSize(); });

document.getElementById('size-apply').addEventListener('click', () => {
    const size = enteredSize();
    if (!(size.width >= SIZE_LIMITS.minWidth && size.width <= SIZE_LIMITS.maxWidth &&
          size.height >= SIZE_LIMITS.minHeight && size.height <= SIZE_LIMITS.maxHeight)) {
        sizeError.textContent = 'Width must be ' + metres(SIZE_LIMITS.minWidth) + '–' + metres(SIZE_LIMITS.maxWidth) +
            ' m and height ' + metres(SIZE_LIMITS.minHeight) + '–' + metres(SIZE_LIMITS.maxHeight) + ' m.';
        return;
    }
    const bid = boardId;
    socket.emit('resizeBoard', { room: room, board: bid, width: size.width, height: size.height }, (result) => {
        if (result && result.ok) {
            closeSize();
            if (bid === boardId) { zoom = 1; onResize(); canvasHolder.scrollLeft = 0; window.scrollTo(0, 0); }
            if (!result.unchanged) controls.setStatus('Board is now ' + describeSize(result.width, result.height));
        } else {
            sizeError.textContent = (result && result.error) || 'Could not change the size.';
        }
    });
});

onResize()

let exportImage = document.getElementById('export-image');
exportImage.addEventListener('click', () => {
    if (canvas) downloadCanvas(canvas, exportFilename(boardName, room));
})


const boardsOverlay = document.getElementById('boards-overlay');
const boardsList = document.getElementById('boards-list');

function renderBoardList(boards) {
    boardsList.innerHTML = '';
    if (!boards.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No saved boards yet. Press Save to keep a whiteboard.';
        boardsList.appendChild(empty);
        return;
    }
    boards.forEach((b) => {
        const row = document.createElement('div');
        row.className = 'board-row' + (b.room === room && b.board === boardId ? ' current' : '');
        const info = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'board-title';
        title.textContent = b.name || 'Untitled board';
        const meta = document.createElement('div');
        meta.className = 'board-meta';
        meta.textContent = 'Room ' + b.room + ' \u00b7 saved ' + formatDate(b.savedAt);
        info.appendChild(title);
        info.appendChild(meta);
        const links = document.createElement('div');
        const open2d = document.createElement('a');
        open2d.className = 'button';
        open2d.href = 'index.html?room=' + encodeURIComponent(b.room) + '&board=' + encodeURIComponent(b.board);
        open2d.textContent = 'Open';
        const openVr = document.createElement('a');
        openVr.className = 'button';
        openVr.href = 'vr.html?room=' + encodeURIComponent(b.room) + '&board=' + encodeURIComponent(b.board);
        openVr.textContent = 'Open in VR';
        links.appendChild(open2d);
        links.appendChild(openVr);
        row.appendChild(info);
        row.appendChild(links);
        boardsList.appendChild(row);
    });
}

let savedBoards = document.getElementById('saved-boards');
savedBoards.addEventListener('click', () => {
    boardsList.textContent = 'Loading\u2026';
    boardsOverlay.classList.remove('hidden');
    fetch('/api/boards')
        .then((res) => res.json())
        .then((data) => renderBoardList(data.boards || []))
        .catch(() => { boardsList.textContent = 'Could not load saved boards.'; });
})
document.getElementById('close-boards').addEventListener('click', () => {
    boardsOverlay.classList.add('hidden');
});
boardsOverlay.addEventListener('click', (e) => {
    if (e.target === boardsOverlay) {
        boardsOverlay.classList.add('hidden');
    }
});

let eraseAll = document.getElementById('erase-all');
eraseAll.addEventListener('click', () => {
    var eraseAllObject= {};
    eraseAllObject.id = id;
    eraseAllObject.room = room;
    eraseAllObject.board = boardId;
    if (!boardId) return;
    socket.emit('eraseAll', eraseAllObject);
    eraseAllRemote(eraseAllObject);
})

let joinRoom = document.getElementById('join-room');
joinRoom.addEventListener('click', () => {
    let enteredRoom = window.prompt("Room Code: ","");
    if (enteredRoom == null || enteredRoom == "") {
        // canceled
      } else {
        enteredRoom = enteredRoom.toUpperCase();
        window.location.href = "index.html?room="+enteredRoom;
      }
})

// Offer to restore unsaved whiteboards left over from a crash or restart.
const recovery = createRecoveryUI({ room: room, page: 'index.html' });
const recoverButton = document.getElementById('recover-boards');
recovery.onCount((n) => {
    recoverButton.classList.toggle('hidden', !n);
    recoverButton.textContent = 'Restore unsaved (' + n + ')';
});
recoverButton.addEventListener('click', () => recovery.open());
recovery.check(true);

const overlay = document.querySelector(".overlay");
const startButton = document.querySelector("#start-button");
startButton.addEventListener('click', () => {
    overlay.classList.add("hidden");
});
overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
        overlay.classList.add("hidden");
    };
});