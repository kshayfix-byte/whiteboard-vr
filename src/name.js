// Small 2D page opened in its own window from VR, so a board can be named
// without a text box inside the headset.
import io from 'socket.io-client';
import { normalizeRoom } from './board-client';

const params = new URLSearchParams(window.location.search);
const room = normalizeRoom(params.get('room'));
const board = params.get('board') || 'main';
const action = params.get('action') === 'rename' ? 'rename' : 'save';

const form = document.getElementById('name-form');
const input = document.getElementById('name-input');
const saveButton = document.getElementById('save-button');
const message = document.getElementById('message');
const current = document.getElementById('current');

document.getElementById('heading').textContent = action === 'rename' ? 'Rename this whiteboard' : 'Name and save this whiteboard';
saveButton.textContent = action === 'rename' ? 'Rename' : 'Save';
document.getElementById('close-button').addEventListener('click', () => window.close());

function show(text, kind) {
    message.textContent = text;
    message.className = kind || '';
}

if (!room) {
    current.textContent = 'No room was given.';
} else {
    const socket = io();
    let filled = false;
    socket.on('connect', () => socket.emit('join', { room: room, board: board, infoOnly: true }));
    socket.on('roomInfo', (info) => {
        if (info.room !== room) return;
        const b = info.boards.find((x) => x.id === board);
        if (!b) return;
        current.textContent = 'Room ' + room + ' · current name: ' + b.name + (b.named ? '' : ' (temporary)');
        if (!filled) {
            input.value = b.name;
            input.select();
            filled = true;
        }
        saveButton.disabled = false;
    });

    form.addEventListener('submit', (evt) => {
        evt.preventDefault();
        const name = input.value.trim();
        if (!name) {
            show('Please type a name.', 'error');
            return;
        }
        saveButton.disabled = true;
        const event = action === 'rename' ? 'renameBoard' : 'saveBoard';
        socket.emit(event, { room: room, board: board, name: name }, (result) => {
            saveButton.disabled = false;
            if (result && result.ok) {
                show((action === 'rename' ? 'Renamed to ' : 'Saved as ') + '“' + result.name + '”. You can close this window and go back to VR.', 'ok');
                setTimeout(() => window.close(), 2500);
            } else {
                show((result && result.error) || 'Something went wrong.', 'error');
            }
        });
    });
}
