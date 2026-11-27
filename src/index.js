import io from 'socket.io-client';
import {
    DEFAULT_BACKGROUND, normalizeRoom, clearCanvas, drawSegment, replayBoard,
    exportFilename, downloadCanvas, formatDate
} from './board-client';
import { createSaveControls } from './save-controls';
import { createRecoveryUI } from './recovery-ui';

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
let background = DEFAULT_BACKGROUND;
let boardId = 'main'; // the "add whiteboard" feature will switch this
let boardName = '';
let loaded = false;
let color = "#000000";
let size = 10;
let clearing = false;

const canvasWidth = 1500;
const canvasHeight = 1000;

const canvas = document.querySelector("#canvas");
canvas.width = canvasWidth;
canvas.height = canvasHeight;
const context2D = canvas.getContext( "2d" );

// draw background
clearCanvas(context2D, canvas, background);

createSaveControls({
    socket: socket,
    room: room,
    boardId: boardId,
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

// Ask the server for the current board on every (re)connect.
socket.on('connect', () => {
    socket.emit('join', { room: room, board: boardId });
});

socket.on('boardState', (state) => {
    if (normalizeRoom(state.room) !== room) return;
    background = state.background || DEFAULT_BACKGROUND;
    replayBoard(context2D, canvas, state);
    loaded = true;
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


canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mouseup', onMouseUp);

function eraseAllRemote(eraseAllRemoteObject) {
    if (room != normalizeRoom(eraseAllRemoteObject.room)) {
        return;
    }
    clearCanvas(context2D, canvas, background);
}

function drawRemote(remoteDrawObject) {
    if (room != normalizeRoom(remoteDrawObject.room)) {
        return;
    }
    drawSegment(context2D, remoteDrawObject, background);
}

function draw (x, y) {
    // Don't draw until the saved board has loaded, so nothing gets painted over.
    if (loaded && lastX != null && lastY != null) {        
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
        socket.emit('draw', drawObject);
        drawRemote(drawObject);
        lastX = x;
        lastY = y;
    }
}

function onMouseMove( evt ) {

    evt.preventDefault();

    let scalingX = canvasWidth / canvas.clientWidth;
    let scalingY = canvasHeight / canvas.clientHeight;

    let x = (evt.pageX - canvas.offsetLeft) * scalingX;
    let y = (evt.pageY - canvas.offsetTop) * scalingY;
    draw(x,y);

}
function onMouseDown (evt) {
    let scalingX = canvasWidth / canvas.clientWidth;
    let scalingY = canvasHeight / canvas.clientHeight;

    lastX = (evt.pageX - canvas.offsetLeft) * scalingX;
    lastY = (evt.pageY - canvas.offsetTop) * scalingY;
}
function onMouseUp (evt) {
    lastX = null;
    lastY = null;
}

canvas.addEventListener('touchstart', function (evt) {
    evt.preventDefault();

    let scalingX = canvasWidth / canvas.clientWidth;
    let scalingY = canvasHeight / canvas.clientHeight;

    lastX = (evt.targetTouches[0].pageX - canvas.offsetLeft) * scalingX;
    lastY = (evt.targetTouches[0].pageY - canvas.offsetTop) * scalingY;
}, false);
  
  canvas.addEventListener('touchmove', function (evt) {
    evt.preventDefault();
    let scalingX = canvasWidth / canvas.clientWidth;
    let scalingY = canvasHeight / canvas.clientHeight;

    let x = (evt.targetTouches[0].pageX - canvas.offsetLeft) * scalingX;
    let y = (evt.targetTouches[0].pageY - canvas.offsetTop) * scalingY;
    draw(x,y);
  }, true);
  
  canvas.addEventListener('touchend', function (evt) {
    evt.preventDefault();
    lastX = null;
    lastY = null;
  }, false);
  
  canvas.addEventListener('touchcancel', function () {
    lastX = null;
    lastY = null;
  });


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

function onResize() {
    canvas.style.width = "94%";
    const height = canvas.clientWidth / 1.5;
    if (height > window.innerHeight * 0.9) {
        canvas.style.height = window.innerHeight - 100 + "px";
        canvas.style.width = canvas.clientHeight / 0.66 + "px";
    } else {
        canvas.style.height = canvas.clientWidth / 1.5 + "px";
    }
}

onResize()

let exportImage = document.getElementById('export-image');
exportImage.addEventListener('click', () => {
    downloadCanvas(canvas, exportFilename(boardName, room));
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
        open2d.href = 'index.html?room=' + encodeURIComponent(b.room);
        open2d.textContent = 'Open';
        const openVr = document.createElement('a');
        openVr.className = 'button';
        openVr.href = 'vr.html?room=' + encodeURIComponent(b.room);
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