require('aframe');
require('aframe-environment-component');
require('./components/texture-painter.component');
require('./components/color-picker.component');
require('./components/size-smaller.component');
require('./components/size-bigger.component');
require('./components/eraser-picker.component');
require('./components/highlighter-picker.component');
require('./components/erase-all.component');
require('./components/intersection-visual.component');
require('./components/room-number.component');
require('./components/vr-button.component');
require('./components/reach-line.component');
import { createSaveControls } from './save-controls';
import { createRecoveryUI } from './recovery-ui';
import { normalizeRoom, BOARD_SIZES, describeSize, presetFor, isWrapBoard, describeWrapSize } from './board-client';
import {
    socket, room, initialBoard, tools, onToolChange, selectedBoard, selectBoard, onSelect
} from './vr/session';
import { layoutBoards, describePose, boardMetres, insideWrap } from './vr/layout';
import { wrapMetres } from './vr/wrap-surface';
import { createBoardMover } from './vr/board-mover';
import { createLocomotion } from './vr/locomotion';
import { reachMode, setReachMode, onReachChange } from './vr/reach';
import { createToolPanel, describePanelMode } from './vr/tool-panel';
import { createMultiClick } from './triple-click';
import { createLook } from './vr/button-look';

const FRAME_COLOR = '#acacac';
const SELECTED_FRAME_COLOR = '#FFA500';
const HELD_FRAME_COLOR = '#3BA3FF';

// ---- Whiteboards in the scene: one entity per board in the room ----
const boardEls = {};   // id -> { root, plane, frame, frameParts, labels, labelEl, width, height, shape, pose }
let roomBoards = [];   // roomInfo.boards, oldest first
let mover = null;      // moves boards by hand (vr/board-mover.js)

function painter(id) {
    const entry = boardEls[id || selectedBoard()];
    return entry && entry.plane.components['texture-painter'];
}

// Run fn with the board's painter once its components are ready.
function withPainter(id, fn) {
    const entry = boardEls[id];
    if (!entry) return;
    const p = entry.plane.components['texture-painter'];
    // The component object exists before its init() has run; `ready` is set in init.
    if (p && p.ready) fn(p);
    else entry.plane.addEventListener('loaded', () => fn(entry.plane.components['texture-painter']), { once: true });
}

function shortName(name) {
    name = name || '';
    return name.length > 28 ? name.slice(0, 27) + '\u2026' : name;
}

// Put every board in its place. The layout depends on all the boards' sizes,
// so it is worked out for the whole room at once.
function placeBoards() {
    const ids = roomBoards.map((b) => b.id).filter((id) => boardEls[id]);
    // Boards whose roomInfo hasn't arrived yet go after the known ones.
    Object.keys(boardEls).forEach((id) => { if (ids.indexOf(id) === -1) ids.push(id); });
    const list = ids.map((id) => {
        const info = roomBoards.find((b) => b.id === id);
        return { width: boardEls[id].width, height: boardEls[id].height, shape: boardEls[id].shape, pose: info && info.pose };
    });
    const poses = layoutBoards(list);
    ids.forEach((id, i) => {
        const entry = boardEls[id];
        const pose = poses[i];
        if (mover && mover.isHeld(id)) return; // the hand holding it decides
        entry.root.setAttribute('position', pose.position.join(' '));
        entry.root.setAttribute('rotation', '0 ' + pose.rotationY + ' 0');
        entry.pose = pose;
    });
}

// Set the plane, frame and name tag to the board's size in metres.
function sizeBoardEl(entry, width, height) {
    const m = boardMetres(width, height);
    entry.width = width;
    entry.height = height;
    if (entry.shape === 'cylinder') return; // fixed size, built in createWrapBoardEl
    entry.plane.setAttribute('width', m.w);
    entry.plane.setAttribute('height', m.h);
    entry.frame.setAttribute('width', m.w + 0.06);
    entry.frame.setAttribute('height', m.h + 0.05);
    entry.labelEl.setAttribute('position', '0 ' + ((m.h + 0.05) / 2 + 0.045) + ' 0');
}

// A name tag: a white strip with the board's name on it.
function createLabel() {
    const label = document.createElement('a-entity');
    const labelBack = document.createElement('a-plane');
    labelBack.setAttribute('width', 0.5);
    labelBack.setAttribute('height', 0.055);
    labelBack.setAttribute('material', 'color: #FFFFFF; opacity: 0.85; transparent: true');
    const labelText = document.createElement('a-text');
    labelText.setAttribute('align', 'center');
    labelText.setAttribute('color', '#222');
    labelText.setAttribute('width', 0.5);
    labelText.setAttribute('wrap-count', 30);
    labelText.setAttribute('position', '0 0 0.002');
    labelText.setAttribute('value', '');
    label.appendChild(labelBack);
    label.appendChild(labelText);
    return { el: label, text: labelText, back: labelBack };
}

// A 360-degree board: a round wall you stand inside (see vr/wrap-surface.js).
// Its "frame" is a rim round the top and bottom edges; its name tag is on the
// front of the wall, once facing in and once facing out.
function createWrapBoardEl(id, width, height) {
    const container = document.getElementById('boards');
    const m = wrapMetres(width, height);

    const root = document.createElement('a-entity');
    root.setAttribute('data-board', id);

    const wall = document.createElement('a-entity');
    wall.setAttribute('class', 'hittable');
    wall.setAttribute('texture-painter', { board: id, width: width, height: height, shape: 'cylinder' });
    wall.setAttribute('intersection-visual', { color: tools.clearing ? (tools.eraserColor || 'pink') : tools.color, size: tools.size });

    const frame = document.createElement('a-entity');
    const frameParts = [-1, 1].map((side) => {
        const rim = document.createElement('a-torus');
        rim.setAttribute('radius', m.radius + 0.015);
        rim.setAttribute('radius-tubular', 0.012);
        rim.setAttribute('segments-radial', 8);
        rim.setAttribute('segments-tubular', 128);
        rim.setAttribute('rotation', '90 0 0');
        rim.setAttribute('position', '0 ' + (side * (m.h / 2 + 0.012)) + ' 0');
        rim.setAttribute('material', 'color: ' + FRAME_COLOR + '; roughness: 0.6; metalness: 0.8');
        frame.appendChild(rim);
        return rim;
    });

    const inside = createLabel();
    inside.el.setAttribute('position', '0 ' + (m.h / 2 + 0.07) + ' ' + (-(m.radius - 0.02)));
    const outside = createLabel();
    outside.el.setAttribute('position', '0 ' + (m.h / 2 + 0.07) + ' ' + (-(m.radius + 0.06)));
    outside.el.setAttribute('rotation', '0 180 0');
    outside.el.setAttribute('scale', '2.5 2.5 2.5');  // read from across the room
    outside.el.setAttribute('position', '0 ' + (m.h / 2 + 0.12) + ' ' + (-(m.radius + 0.06)));

    root.appendChild(frame);
    root.appendChild(wall);
    root.appendChild(inside.el);
    root.appendChild(outside.el);
    container.appendChild(root);

    boardEls[id] = {
        root: root, plane: wall, frame: frame, frameParts: frameParts, shape: 'cylinder',
        labels: [inside, outside], labelEl: inside.el, width: width, height: height
    };
    placeBoards();
    return boardEls[id];
}

function createBoardEl(id, width, height, shape) {
    if (shape === 'cylinder') return createWrapBoardEl(id, width || 8000, height || 1800);
    const container = document.getElementById('boards');
    width = width || 1500;
    height = height || 1000;

    const root = document.createElement('a-entity');
    root.setAttribute('data-board', id);

    const plane = document.createElement('a-plane');
    plane.setAttribute('class', 'hittable');
    plane.setAttribute('geometry', 'buffer: false');
    plane.setAttribute('texture-painter', { board: id, width: width, height: height });
    plane.setAttribute('intersection-visual', { color: tools.clearing ? (tools.eraserColor || 'pink') : tools.color, size: tools.size });

    const frame = document.createElement('a-box');
    frame.setAttribute('material', 'color: ' + FRAME_COLOR + '; roughness: 0.6; metalness: 0.8');
    frame.setAttribute('depth', 0.0105);
    frame.setAttribute('position', '0 0 -0.01');

    // Name tag above the board (kept small so it fits between the room
    // number and the size buttons on the first board).
    const label = createLabel();

    root.appendChild(frame);
    root.appendChild(plane);
    root.appendChild(label.el);
    container.appendChild(root);

    boardEls[id] = { root: root, plane: plane, frame: frame, frameParts: [frame], shape: 'flat', labels: [label], labelEl: label.el };
    sizeBoardEl(boardEls[id], width, height);
    placeBoards();
    return boardEls[id];
}

// A board was resized: resize its entity and canvas, then re-place every
// board (a bigger board can push its neighbours along the ring).
function resizeBoardEl(id, width, height) {
    const entry = boardEls[id];
    if (!entry || (entry.width === width && entry.height === height)) return false;
    sizeBoardEl(entry, width, height);
    withPainter(id, (p) => p.resize(width, height));
    placeBoards();
    return true;
}

function paintBoardEl(id) {
    const entry = boardEls[id];
    if (!entry) return;
    const info = roomBoards.find((b) => b.id === id);
    const selected = id === selectedBoard();
    const name = (entry.shape === 'cylinder' ? '360: ' : '') + (info ? info.name : '');
    entry.labels.forEach((label) => {
        label.text.setAttribute('value', (selected ? '> ' : '') + shortName(name) + (info && !info.named ? ' (unsaved)' : ''));
        label.back.setAttribute('material', 'color', selected ? '#FFE0A6' : '#FFFFFF');
    });
    const held = mover && mover.isHeld(id);
    const color = held ? HELD_FRAME_COLOR : selected ? SELECTED_FRAME_COLOR : FRAME_COLOR;
    entry.frameParts.forEach((part) => part.setAttribute('material', 'color', color));
}

// Keep every board's pen marker in step with the shared pen settings.
onToolChange(() => {
    const color = tools.clearing ? (tools.eraserColor || 'pink') : tools.color;
    Object.keys(boardEls).forEach((id) => {
        boardEls[id].plane.setAttribute('intersection-visual', { color: color, size: tools.size });
    });
});

window.addEventListener('DOMContentLoaded', () => {
    // "Go inside" button for 360-degree boards; set further down, once the
    // moving code exists.
    let updateInsideButton = function () {};
    const statusEl = document.getElementById('vr-save-status');
    const sceneStatus = document.getElementById('vr-status-text');
    const saveAllButton = document.getElementById('vr-save-all-box');
    let sceneTimer = null;

    function showInScene(text) {
        if (!sceneStatus) return;
        sceneStatus.setAttribute('value', text);
        clearTimeout(sceneTimer);
        sceneTimer = setTimeout(() => sceneStatus.setAttribute('value', ''), 5000);
    }

    const controls = createSaveControls({
        socket: socket,
        room: room,
        boardId: initialBoard || 'main',
        elements: {
            name: document.getElementById('vr-board-name'),
            state: document.getElementById('vr-board-state'),
            status: statusEl,
            save: document.getElementById('vr-save'),
            rename: document.getElementById('vr-rename'),
            saveAll: document.getElementById('vr-save-all')
        },
        onChange: (board, info) => {
            if (saveAllButton) saveAllButton.setAttribute('vr-button', 'enabled', !!(info && info.allNamed));
        }
    });

    // ---- Boards: create, place, label, select ----
    const boardSelect = document.getElementById('vr-board-select');
    const nextBoardButton = document.getElementById('vr-next-board-box');
    const scene = document.querySelector('a-scene');

    function describeSelected() {
        const id = selectedBoard();
        const index = roomBoards.findIndex((b) => b.id === id);
        const info = roomBoards[index];
        if (!info) return '';
        return 'Selected: ' + shortName(info.name) + (roomBoards.length > 1 ? '  (' + (index + 1) + ' of ' + roomBoards.length + ')' : '');
    }

    function refreshBoards() {
        placeBoards();
        Object.keys(boardEls).forEach((id) => paintBoardEl(id));
        // Desktop (non-headset) picker
        boardSelect.innerHTML = '';
        roomBoards.forEach((b) => {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name + (b.named ? '' : ' (unsaved)');
            boardSelect.appendChild(opt);
        });
        boardSelect.value = selectedBoard() || '';
        if (nextBoardButton) nextBoardButton.setAttribute('vr-button', 'enabled', roomBoards.length > 1);
        if (removeBoardBox) removeBoardBox.setAttribute('vr-button', 'enabled', roomBoards.length > 1);
        removeBoardButton.disabled = roomBoards.length <= 1;
        const info = roomBoards.find((b) => b.id === selectedBoard());
        document.title = (info ? info.name + ' - ' : '') + 'Whiteboard VR';
        update2dLink();
        scene.emit('board-renamed', { name: describeSelected() });
    }

    // ---- "2D view": back to the flat page for this room and board ----
    const twoDLink = document.getElementById('vr-2d-view');
    function update2dLink() {
        if (!twoDLink) return;
        const id = selectedBoard();
        twoDLink.href = 'index.html?room=' + encodeURIComponent(room) +
            (id && id !== 'main' ? '&board=' + encodeURIComponent(id) : '');
    }
    if (twoDLink) {
        update2dLink();
        onSelect(update2dLink);
        twoDLink.addEventListener('click', (evt) => {
            // Leave full screen / immersive mode first so the browser shows the page.
            if (scene.is && scene.is('vr-mode')) {
                evt.preventDefault();
                const go = () => { window.location.href = twoDLink.href; };
                Promise.resolve(scene.exitVR()).then(go, go);
            }
        });
    }

    // ---- Remove whiteboard: three presses in a row ----
    const removeBoardBox = document.getElementById('vr-remove-board-box');
    const removeLabel = document.getElementById('vr-remove-label');
    const removeBoardButton = document.getElementById('vr-remove-board');
    const REMOVE_TEXT = 'Remove board (x3)';
    const removeGuard = createMultiClick({
        count: 3,
        onProgress: (left, id) => {
            const info = roomBoards.find((b) => b.id === id);
            const text = 'Remove \u201c' + shortName(info ? info.name : '') + '\u201d? Press ' + left + ' more time' + (left === 1 ? '' : 's');
            showInScene(text);
            if (removeLabel) removeLabel.setAttribute('value', 'Press ' + left + ' more');
            removeBoardButton.classList.add('arming');
            removeBoardButton.textContent = 'Click ' + left + ' more time' + (left === 1 ? '' : 's') + ' to remove';
        },
        onReset: () => {
            if (removeLabel) removeLabel.setAttribute('value', REMOVE_TEXT);
            removeBoardButton.classList.remove('arming');
            removeBoardButton.textContent = 'Remove whiteboard';
        },
        onConfirm: (id) => {
            removeGuard.reset();
            socket.emit('removeBoard', { room: room, board: id }, (result) => {
                if (result && result.ok) controls.setStatus('Removed \u201c' + result.name + '\u201d');
                else controls.setStatus((result && result.error) || 'Could not remove the whiteboard.', true);
            });
        }
    });
    removeBoardButton.addEventListener('click', () => { if (selectedBoard()) removeGuard.press(selectedBoard()); });

    // ---- Erase board: three presses in a row, like Remove (bug 4) ----
    const eraseLabel = document.getElementById('vr-erase-all-label');
    const eraseButton = document.getElementById('vr-erase-board'); // desktop toolbar
    const ERASE_TEXT = 'Erase board (x3)';
    const eraseGuard = createMultiClick({
        count: 3,
        onProgress: (left, id) => {
            const info = roomBoards.find((b) => b.id === id);
            showInScene('Erase \u201c' + shortName(info ? info.name : '') + '\u201d? Press ' + left + ' more time' + (left === 1 ? '' : 's'));
            if (eraseLabel) eraseLabel.setAttribute('value', 'Press ' + left + ' more');
            eraseButton.classList.add('arming');
            eraseButton.textContent = 'Click ' + left + ' more time' + (left === 1 ? '' : 's') + ' to erase';
        },
        onReset: () => {
            if (eraseLabel) eraseLabel.setAttribute('value', ERASE_TEXT);
            eraseButton.classList.remove('arming');
            eraseButton.textContent = 'Erase board';
        },
        onConfirm: (id) => {
            eraseGuard.reset();
            if (id === selectedBoard() && painter()) painter().eraseAll();
        }
    });
    eraseButton.addEventListener('click', () => { if (selectedBoard()) eraseGuard.press(selectedBoard()); });

    socket.on('boardRemoved', (msg) => {
        if (!msg || normalizeRoom(msg.room) !== room || !boardEls[msg.board]) return;
        const index = roomBoards.findIndex((b) => b.id === msg.board);
        boardEls[msg.board].root.parentNode.removeChild(boardEls[msg.board].root);
        delete boardEls[msg.board];
        roomBoards = roomBoards.filter((b) => b.id !== msg.board);
        if (selectedBoard() === msg.board) {
            const next = roomBoards[Math.max(0, index - 1)];
            if (next) selectBoard(next.id);
        }
        refreshBoards();
    });

    onSelect((id) => {
        removeGuard.reset();
        eraseGuard.reset();
        controls.setBoard(id);
        refreshBoards();
        updateSizeLabel();
    });

    boardSelect.addEventListener('change', () => selectBoard(boardSelect.value));

    socket.on('boardState', (state) => {
        if (normalizeRoom(state.room) !== room) return;
        if (!boardEls[state.board]) createBoardEl(state.board, state.width, state.height, state.shape);
        else resizeBoardEl(state.board, state.width || 1500, state.height || 1000);
        withPainter(state.board, (p) => p.loadState(state));
        if (state.board === selectedBoard()) updateSizeLabel();
    });

    socket.on('roomInfo', (info) => {
        if (!info || normalizeRoom(info.room) !== room) return;
        roomBoards = info.boards || [];
        if (!selectedBoard() || !roomBoards.some((b) => b.id === selectedBoard())) {
            const first = roomBoards.find((b) => b.id === initialBoard) || roomBoards[0];
            if (first) selectBoard(first.id);
        }
        refreshBoards();
    });

    // Load every board of the room now and again after any reconnect.
    const join = () => socket.emit('join', { room: room, board: selectedBoard() || initialBoard || 'main' });
    socket.on('connect', join);
    if (socket.connected) join();

    function addBoard(shape) {
        socket.emit('addBoard', { room: room, shape: shape === 'cylinder' ? 'cylinder' : 'flat' }, (result) => {
            if (result && result.ok) {
                selectBoard(result.board);
                const entry = boardEls[result.board];
                const where = entry && entry.pose ? ' ' + describePose(entry.pose) : '';
                controls.setStatus('Added ' + (result.shape === 'cylinder' ? '360 board ' : '') + '\u201c' + result.name + '\u201d' + where +
                    (result.shape === 'cylinder' ? '. Press Go inside to step into it.' : ''));
            } else {
                controls.setStatus((result && result.error) || 'Could not add a whiteboard.', true);
            }
        });
    }

    // ---- Board size: the VR button steps through the ready-made sizes ----
    const sizeLabel = document.getElementById('vr-size-label');
    const sizeSelect = document.getElementById('vr-board-size');
    const sizeBox = document.getElementById('vr-size-box');

    function updateSizeLabel() {
        const entry = boardEls[selectedBoard()];
        if (!entry) return;
        if (entry.shape === 'cylinder') {
            const wrapText = describeWrapSize(entry.width, entry.height);
            // 360 boards have a fixed size (bug V10): say so on the button and grey it out.
            if (sizeLabel) sizeLabel.setAttribute('value', 'Size: fixed (360)');
            if (sizeBox) sizeBox.setAttribute('vr-button', 'enabled', false);
            if (sizeSelect) {
                sizeSelect.value = 'custom';
                sizeSelect.disabled = true;
                const c = sizeSelect.querySelector('option[value="custom"]');
                if (c) c.textContent = '360\u00b0 board (' + wrapText + ')';
            }
            updateInsideButton();
            return;
        }
        if (sizeSelect) sizeSelect.disabled = false;
        if (sizeBox) sizeBox.setAttribute('vr-button', 'enabled', true);
        updateInsideButton();
        const preset = presetFor(entry.width, entry.height);
        const text = describeSize(entry.width, entry.height);
        // The headset font has no × sign, so use a plain x there.
        if (sizeLabel) sizeLabel.setAttribute('value', 'Size: ' + text.replace('\u00d7', 'x'));
        if (sizeSelect) sizeSelect.value = preset ? preset.id : 'custom';
        const custom = sizeSelect && sizeSelect.querySelector('option[value="custom"]');
        if (custom) custom.textContent = 'Custom (' + text + ')';
    }

    function resizeSelected(size) {
        const id = selectedBoard();
        if (!id) return;
        socket.emit('resizeBoard', { room: room, board: id, width: size.width, height: size.height }, (result) => {
            if (result && result.ok) {
                if (!result.unchanged) controls.setStatus('Board is now ' + describeSize(result.width, result.height));
            } else {
                controls.setStatus((result && result.error) || 'Could not change the size.', true);
            }
            updateSizeLabel();
        });
    }

    function nextSize() {
        const entry = boardEls[selectedBoard()];
        if (!entry) return;
        if (entry.shape === 'cylinder') {
            showInScene('360 boards have a fixed size (' + describeWrapSize(entry.width, entry.height).replace('\u00d7', 'x') + ').');
            return;
        }
        const index = BOARD_SIZES.findIndex((p) => p.width === entry.width && p.height === entry.height);
        resizeSelected(BOARD_SIZES[(index + 1) % BOARD_SIZES.length]);
    }

    if (sizeSelect) {
        BOARD_SIZES.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label + ' (' + describeSize(p.width, p.height) + ')';
            sizeSelect.appendChild(opt);
        });
        const custom = document.createElement('option');
        custom.value = 'custom';
        custom.disabled = true;
        custom.textContent = 'Custom';
        sizeSelect.appendChild(custom);
        sizeSelect.addEventListener('change', () => {
            const preset = BOARD_SIZES.find((p) => p.id === sizeSelect.value);
            if (preset) resizeSelected(preset);
        });
    }

    function nextBoard() {
        if (roomBoards.length < 2) return;
        const index = roomBoards.findIndex((b) => b.id === selectedBoard());
        const next = roomBoards[(index + 1) % roomBoards.length];
        selectBoard(next.id);
        const entry = boardEls[next.id];
        showInScene('Selected \u201c' + shortName(next.name) + '\u201d' + (entry && entry.pose ? ' ' + describePose(entry.pose) : ''));
    }

    // ---- Moving boards (grip button in VR, Move panel on desktop) ----
    function setLocalPose(id, pose) {
        const info = roomBoards.find((b) => b.id === id);
        if (info) info.pose = pose;
        placeBoards();
    }

    let toolPanel = null;   // set further down; the grip and thumbsticks ask it first
    mover = createBoardMover({
        scene: scene,
        socket: socket,
        room: room,
        boardIds: () => Object.keys(boardEls),
        entry: (id) => boardEls[id],
        size: (id) => (boardEls[id] ? boardMetres(boardEls[id].width, boardEls[id].height) : null),
        selected: selectedBoard,
        select: selectBoard,
        canGrab: (id) => !(boardEls[id] && boardEls[id].shape === 'cylinder'),
        skipGrab: (controller) => !!(toolPanel && toolPanel.wantsGrip(controller)),
        onLocalPose: (id, pose) => {
            setLocalPose(id, pose);
            updateMoveState();
        },
        onHeldChange: (id) => {
            Object.keys(boardEls).forEach((b) => paintBoardEl(b));
            if (id) {
                const info = roomBoards.find((b) => b.id === id);
                showInScene('Moving \u201c' + shortName(info ? info.name : '') + '\u201d. Let go of the grip to drop it.');
            }
        },
        status: (text, isError) => controls.setStatus(text, isError)
    });

    // Someone else moved a board.
    socket.on('boardPose', (msg) => {
        if (!msg || normalizeRoom(msg.room) !== room || !boardEls[msg.board]) return;
        if (mover.isHeld(msg.board)) return; // we're holding it; ours wins when we let go
        setLocalPose(msg.board, msg.pose || null);
        updateMoveState();
    });

    const movePanel = document.getElementById('vr-move-panel');
    const moveToggle = document.getElementById('vr-move-toggle');
    const moveState = document.getElementById('vr-move-state');
    const autoPlaceBox = document.getElementById('vr-auto-place-box');

    function updateMoveState() {
        const info = roomBoards.find((b) => b.id === selectedBoard());
        const moved = !!(info && info.pose);
        if (moveState) moveState.textContent = moved ? 'Placed by hand' : 'Placed automatically';
        const autoButton = document.getElementById('vr-auto-place');
        if (autoButton) autoButton.disabled = !moved;
        // The VR button stays pressable, so pressing it can explain itself (bug V11).
        if (autoPlaceBox) autoPlaceBox.setAttribute('vr-button', 'enabled', true);
    }
    onSelect(updateMoveState);
    socket.on('roomInfo', updateMoveState);

    // "Reset position" (was "Auto place", bug V11): a board you moved goes
    // back to where the automatic layout puts it.
    function resetPosition() {
        const id = selectedBoard();
        const info = roomBoards.find((b) => b.id === id);
        if (!info) return;
        if (!info.pose) {
            showInScene('\u201c' + shortName(info.name) + '\u201d hasn\u2019t been moved, so it is already in its own place. ' +
                'Reset position puts a board you moved (grip, or Move board) back there.');
            return;
        }
        if (mover.autoPlace(id)) showInScene('\u201c' + shortName(info.name) + '\u201d is back in its own place.');
    }

    if (moveToggle && movePanel) {
        moveToggle.addEventListener('click', () => {
            const open = movePanel.hasAttribute('hidden');
            if (open) movePanel.removeAttribute('hidden');
            else movePanel.setAttribute('hidden', '');
            moveToggle.classList.toggle('active', open);
        });
        movePanel.querySelectorAll('button[data-move]').forEach((button) => {
            button.addEventListener('click', () => mover.nudge(button.getAttribute('data-move')));
        });
        document.getElementById('vr-auto-place').addEventListener('click', resetPosition);
    }

    // ---- Moving yourself around, and how far the pointer reaches ----
    const locomotion = createLocomotion({
        scene: scene,
        rig: document.getElementById('rig'),
        camera: document.getElementById('camera'),
        busy: (controller) => mover.holds(controller) || !!(toolPanel && toolPanel.holds(controller)),
        status: showInScene
    });
    const movingLabel = document.getElementById('vr-moving-label');
    const reachLabel = document.getElementById('vr-reach-label');
    function paintMoving() {
        if (movingLabel) movingLabel.setAttribute('value', 'Moving: ' + (locomotion.mode() === 'smooth' ? 'Smooth' : 'Teleport'));
    }
    function paintReach() {
        if (reachLabel) reachLabel.setAttribute('value', 'Reach: ' + (reachMode() === 'short' ? '20 cm' : 'Long'));
    }
    locomotion.onModeChange(paintMoving);
    onReachChange((mode) => {
        paintReach();
        showInScene(mode === 'short'
            ? 'Reach 20 cm: you only draw on a board within 20 cm, like a real pen. The panel buttons still work from any distance.'
            : 'Long reach: point at any board across the room and pull the trigger to draw.');
    });
    paintMoving();
    paintReach();

    // Pen size: the - and + buttons next to it change it (bug V12).
    const penSizeLabel = document.getElementById('vr-pen-size-label');
    let lastPen = { size: tools.size, highlight: tools.highlight };
    function paintPenSize() {
        if (penSizeLabel) penSizeLabel.setAttribute('value', 'Pen size ' + tools.size);
        // Only for - and +, not when picking up the other pen (which has its own size).
        if (tools.size !== lastPen.size && tools.highlight === lastPen.highlight) {
            showInScene((tools.highlight ? 'Highlighter' : 'Marker') + ' size ' + tools.size + ' px (5 to 50). The pen dot on the board shows the size.');
        }
        lastPen = { size: tools.size, highlight: tools.highlight };
    }
    onToolChange(paintPenSize);
    paintPenSize();

    // ---- Where the tool panel sits: follows you, on your wrist, or stays ----
    toolPanel = createToolPanel({
        scene: scene,
        panel: document.getElementById('tool-panel'),
        camera: document.getElementById('camera'),
        busy: () => Array.from(document.querySelectorAll('.controller')).some((c) => mover.holds(c)),
        status: showInScene
    });
    const panelLabel = document.getElementById('vr-panel-label');
    function paintPanel() {
        if (panelLabel) panelLabel.setAttribute('value', 'Panel: ' + describePanelMode(toolPanel.mode()));
    }
    toolPanel.onModeChange(paintPanel);
    paintPanel();
    // The grab handle turns orange when pointed at, like every control.
    const handle = document.getElementById('vr-panel-handle');
    if (handle) createLook(handle, { color: '#4A5560' });

    // ---- Going into (and out of) a 360-degree board ----
    const insideLabel = document.getElementById('vr-inside-label');
    const insideBox = document.getElementById('vr-inside-box');
    const insideButton = document.getElementById('vr-go-inside');

    function selectedWrap() {
        const entry = boardEls[selectedBoard()];
        return entry && entry.shape === 'cylinder' && entry.pose ? entry : null;
    }

    function headInside(entry) {
        const h = locomotion.headPosition();
        return insideWrap(entry.pose, entry.width, h.x, h.z);
    }

    function goInside() {
        const entry = selectedWrap();
        if (!entry) {
            showInScene('Select a 360 board first (point at it, or use Next board).');
            return;
        }
        if (headInside(entry)) {
            locomotion.backToStart();
            toolPanel.backToStart();
            showInScene('Back at the start.');
        } else {
            locomotion.goTo(entry.pose.position[0], entry.pose.position[2], entry.pose.rotationY || 0);
            toolPanel.jumpHere();
            showInScene('You are inside the 360 board. Draw all the way round you. Go inside again (or Back to start) steps out.');
        }
        updateInsideButton();
    }

    updateInsideButton = function () {
        const entry = selectedWrap();
        const inside = !!entry && headInside(entry);
        const text = inside ? 'Step out' : 'Go inside';
        if (insideLabel) insideLabel.setAttribute('value', text);
        if (insideBox) insideBox.setAttribute('vr-button', { enabled: !!entry, active: inside });
        if (insideButton) {
            insideButton.disabled = !entry;
            insideButton.textContent = entry ? text + ' (360\u00b0 board)' : 'Go inside';
            insideButton.title = entry ? 'Jump into the middle of the selected 360\u00b0 board, or back out to the start'
                : 'Select a 360\u00b0 board to step inside it';
        }
    };
    onSelect(updateInsideButton);
    socket.on('roomInfo', () => setTimeout(updateInsideButton, 0));
    if (insideButton) insideButton.addEventListener('click', goInside);
    updateInsideButton();
    window.whiteboardToolPanel = toolPanel; // for testing from the browser console
    setReachMode(reachMode()); // apply the remembered setting to the controllers

    scene.addEventListener('enter-vr', () => {
        setTimeout(() => showInScene(locomotion.mode() === 'smooth'
            ? 'Tip: left thumbstick walks, right thumbstick turns. Grip moves a whiteboard. B or Y brings the tool panel.'
            : 'Tip: push a thumbstick forward and let go to teleport. Grip moves a whiteboard. B or Y brings the tool panel.'), 1500);
    });

    document.getElementById('vr-add-board').addEventListener('click', () => addBoard('flat'));
    document.getElementById('vr-add-wrap-board').addEventListener('click', () => addBoard('cylinder'));

    // Mirror on-screen status messages into the scene so they're visible in a headset.
    if (statusEl && window.MutationObserver) {
        new MutationObserver(() => { if (statusEl.textContent) showInScene(statusEl.textContent); })
            .observe(statusEl, { childList: true, characterData: true, subtree: true });
    }

    // Browsers can't show a text box inside a headset, so to type a name we
    // leave VR, show the normal 2D name box, and the user re-enters VR after.
    function askOutsideVR(ask) {
        if (!scene.is('vr-mode')) {
            ask();
            return;
        }
        scene.addEventListener('exit-vr', () => {
            setTimeout(() => {
                ask();
                controls.setStatus('Press the VR button to go back into VR.');
            }, 300);
        }, { once: true });
        showInScene('Leaving VR so you can type a name\u2026');
        scene.exitVR();
    }

    // First choice for naming in a headset: open a small 2D page in a new
    // browser window. Browsers only allow new windows right after a user
    // action, and in VR that's the controller's "select" event, which fires
    // when the trigger is released. If no window opens, fall back to leaving
    // VR and showing the normal name box.
    let pendingName = null;
    let pendingTimer = null;

    function openNameWindow(action) {
        const url = 'name.html?room=' + encodeURIComponent(room) + '&board=' + encodeURIComponent(selectedBoard() || 'main') + '&action=' + action;
        let win = null;
        try {
            win = window.open(url, 'whiteboard-name', 'width=520,height=420');
        } catch (e) {
            win = null;
        }
        if (win) showInScene('Type the name in the window that just opened.');
        return !!win;
    }

    function exportNow() {
        if (painter()) painter().exportImage();
    }

    function fallback(action) {
        if (action === 'export') return exportNow();
        askOutsideVR(() => (action === 'rename' ? controls.renameCurrent() : controls.saveCurrent(true)));
    }

    // Wait for the trigger release ("select") to run the action; used for
    // naming and for exports.
    function askForName(action) {
        if (!scene.is('vr-mode')) {
            fallback(action);
            return;
        }
        pendingName = action;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
            if (pendingName) {
                const a = pendingName;
                pendingName = null;
                fallback(a);
            }
        }, 1500);
    }

    scene.addEventListener('enter-vr', () => {
        const xr = scene.renderer && scene.renderer.xr;
        const session = xr && xr.getSession && xr.getSession();
        if (!session) return;
        session.addEventListener('select', () => {
            if (!pendingName) return;
            const action = pendingName;
            pendingName = null;
            clearTimeout(pendingTimer);
            if (action === 'export') exportNow(); // downloads also need a user action
            else if (!openNameWindow(action)) fallback(action);
        });
    });

    scene.addEventListener('vr-action', (evt) => {
        const action = evt.detail.action;
        if (action === 'export') {
            if (scene.is('vr-mode')) askForName('export');
            else exportNow();
        } else if (action === 'save') {
            const result = controls.saveCurrent(false);
            if (result.needsName) askForName('save');
        } else if (action === 'rename') {
            askForName('rename');
        } else if (action === 'save-all') {
            controls.saveAll();
        } else if (action === 'add-board') {
            addBoard('flat');
        } else if (action === 'remove-board') {
            if (selectedBoard()) removeGuard.press(selectedBoard());
        } else if (action === 'next-board') {
            nextBoard();
        } else if (action === 'auto-place') {
            resetPosition();
        } else if (action === 'board-size') {
            nextSize();
        } else if (action === 'moving-mode') {
            locomotion.toggleMode();
        } else if (action === 'reach') {
            setReachMode(reachMode() === 'short' ? 'long' : 'short');
        } else if (action === 'back-to-start') {
            locomotion.backToStart();
            toolPanel.backToStart();
            updateInsideButton();
        } else if (action === 'add-wrap-board') {
            addBoard('cylinder');
        } else if (action === 'go-inside') {
            goInside();
        } else if (action === 'panel-mode') {
            toolPanel.nextMode();
        } else if (action === 'erase-all') {
            if (selectedBoard()) eraseGuard.press(selectedBoard());
        }
    });

    // A grey VR button was pressed: say why it can't be used now.
    scene.addEventListener('vr-action-disabled', (evt) => {
        const action = evt.detail.action;
        if (action === 'save-all') {
            showInScene(controls.saveAllReason());
        } else if (action === 'next-board') {
            showInScene('There is only one whiteboard in this room. Add whiteboard makes another.');
        } else if (action === 'remove-board') {
            showInScene('The last whiteboard in a room can\u2019t be removed.');
        } else if (action === 'go-inside') {
            showInScene('Select a 360 board first (point at it, or use Next board). Add 360 board makes one.');
        } else if (action === 'board-size') {
            const entry = boardEls[selectedBoard()];
            showInScene(entry && entry.shape === 'cylinder'
                ? '360 boards have a fixed size (' + describeWrapSize(entry.width, entry.height).replace('\u00d7', 'x') + ').'
                : 'This board\u2019s size can\u2019t be changed right now.');
        }
    });

    // Offer to restore unsaved whiteboards left over from a crash or restart.
    const recovery = createRecoveryUI({ room: room, page: 'vr.html' });
    const recoverButton = document.getElementById('vr-recover');
    recovery.onCount((n) => {
        recoverButton.style.display = n ? '' : 'none';
        recoverButton.textContent = 'Restore unsaved (' + n + ')';
    });
    recoverButton.addEventListener('click', () => recovery.open());
    recovery.check(true);

    const exportButton = document.getElementById('vr-export-image');
    if (exportButton) exportButton.addEventListener('click', () => { if (painter()) painter().exportImage(); });
});
