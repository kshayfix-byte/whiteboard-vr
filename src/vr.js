require('aframe');
require('aframe-environment-component');
require('./components/texture-painter.component');
require('./components/color-picker.component');
require('./components/size-smaller.component');
require('./components/size-bigger.component');
require('./components/eraser-picker.component');
require('./components/erase-all.component');
require('./components/intersection-visual.component');
require('./components/room-number.component');
require('./components/vr-button.component');
import { createSaveControls } from './save-controls';
import { createRecoveryUI } from './recovery-ui';
import { normalizeRoom } from './board-client';
import {
    socket, room, initialBoard, tools, onToolChange, selectedBoard, selectBoard, onSelect
} from './vr/session';
import { boardPose, describePose, BOARD_WIDTH } from './vr/layout';

const FRAME_COLOR = '#acacac';
const SELECTED_FRAME_COLOR = '#FFA500';

// ---- Whiteboards in the scene: one entity per board in the room ----
const boardEls = {};   // id -> { root, plane, frame, label }
let roomBoards = [];   // roomInfo.boards, oldest first

function painter(id) {
    const entry = boardEls[id || selectedBoard()];
    return entry && entry.plane.components['texture-painter'];
}

// Run fn with the board's painter once its components are ready.
function withPainter(id, fn) {
    const entry = boardEls[id];
    if (!entry) return;
    const p = entry.plane.components['texture-painter'];
    // The component object exists before its init() has run; _canvas is set in init.
    if (p && p._canvas) fn(p);
    else entry.plane.addEventListener('loaded', () => fn(entry.plane.components['texture-painter']), { once: true });
}

function shortName(name) {
    name = name || '';
    return name.length > 28 ? name.slice(0, 27) + '\u2026' : name;
}

function placeBoard(id) {
    const entry = boardEls[id];
    const index = roomBoards.findIndex((b) => b.id === id);
    const info = roomBoards[index];
    const pose = boardPose(index < 0 ? Object.keys(boardEls).indexOf(id) : index, info && info.pose);
    entry.root.setAttribute('position', pose.position.join(' '));
    entry.root.setAttribute('rotation', '0 ' + pose.rotationY + ' 0');
    entry.pose = pose;
}

function createBoardEl(id, width, height) {
    const container = document.getElementById('boards');
    const w = BOARD_WIDTH;
    const h = BOARD_WIDTH * (height || 1000) / (width || 1500);

    const root = document.createElement('a-entity');
    root.setAttribute('data-board', id);

    const plane = document.createElement('a-plane');
    plane.setAttribute('class', 'hittable');
    plane.setAttribute('width', w);
    plane.setAttribute('height', h);
    plane.setAttribute('geometry', 'buffer: false');
    plane.setAttribute('texture-painter', { board: id, width: width || 1500, height: height || 1000 });
    plane.setAttribute('intersection-visual', { color: tools.clearing ? (tools.eraserColor || 'pink') : tools.color, size: tools.size });

    const frame = document.createElement('a-box');
    frame.setAttribute('material', 'color: ' + FRAME_COLOR + '; roughness: 0.6; metalness: 0.8');
    frame.setAttribute('width', w * 1.04);
    frame.setAttribute('height', h * 1.05);
    frame.setAttribute('depth', 0.0105);
    frame.setAttribute('position', '0 0 -0.01');

    // Name tag above the board (kept small so it fits between the room
    // number and the size buttons on the first board).
    const label = document.createElement('a-entity');
    label.setAttribute('position', '0 ' + (h * 1.05 / 2 + 0.045) + ' 0');
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

    root.appendChild(frame);
    root.appendChild(plane);
    root.appendChild(label);
    container.appendChild(root);

    boardEls[id] = { root: root, plane: plane, frame: frame, label: labelText, labelBack: labelBack };
    placeBoard(id);
    return boardEls[id];
}

function paintBoardEl(id) {
    const entry = boardEls[id];
    if (!entry) return;
    const info = roomBoards.find((b) => b.id === id);
    const selected = id === selectedBoard();
    const name = info ? info.name : '';
    entry.label.setAttribute('value', (selected ? '> ' : '') + shortName(name) + (info && !info.named ? ' (unsaved)' : ''));
    entry.labelBack.setAttribute('material', 'color', selected ? '#FFE0A6' : '#FFFFFF');
    entry.frame.setAttribute('material', 'color', selected ? SELECTED_FRAME_COLOR : FRAME_COLOR);
}

// Keep every board's pen marker in step with the shared pen settings.
onToolChange(() => {
    const color = tools.clearing ? (tools.eraserColor || 'pink') : tools.color;
    Object.keys(boardEls).forEach((id) => {
        boardEls[id].plane.setAttribute('intersection-visual', { color: color, size: tools.size });
    });
});

window.addEventListener('DOMContentLoaded', () => {
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
        Object.keys(boardEls).forEach((id) => { placeBoard(id); paintBoardEl(id); });
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
        const info = roomBoards.find((b) => b.id === selectedBoard());
        document.title = (info ? info.name + ' - ' : '') + 'Whiteboard VR';
        scene.emit('board-renamed', { name: describeSelected() });
    }

    onSelect((id) => {
        controls.setBoard(id);
        refreshBoards();
    });

    boardSelect.addEventListener('change', () => selectBoard(boardSelect.value));

    socket.on('boardState', (state) => {
        if (normalizeRoom(state.room) !== room) return;
        if (!boardEls[state.board]) createBoardEl(state.board, state.width, state.height);
        withPainter(state.board, (p) => p.loadState(state));
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

    function addBoard() {
        socket.emit('addBoard', { room: room }, (result) => {
            if (result && result.ok) {
                selectBoard(result.board);
                const entry = boardEls[result.board];
                const where = entry && entry.pose ? ' ' + describePose(entry.pose) : '';
                controls.setStatus('Added \u201c' + result.name + '\u201d' + where);
            } else {
                controls.setStatus((result && result.error) || 'Could not add a whiteboard.', true);
            }
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

    document.getElementById('vr-add-board').addEventListener('click', addBoard);

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
            addBoard();
        } else if (action === 'next-board') {
            nextBoard();
        } else if (action === 'erase-all') {
            if (painter()) painter().eraseAll();
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
