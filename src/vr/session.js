// State shared by everything in the VR page: the socket, the room, the
// current drawing tool (shared by every whiteboard), and which whiteboard is
// selected (the one Save, Rename, Export and Erase All act on).
import io from 'socket.io-client';
import { normalizeRoom } from '../board-client';

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
if (!room) {
    room = Math.random().toString(36).substr(2, 5).toUpperCase();
    window.location.href = "vr.html?room=" + room;
}

export { room };
export const initialBoard = getParameterByName('board');
export const socket = io();

// Pen settings, the same for every whiteboard.
export const tools = { color: '#000000', size: 10, clearing: false };

const toolListeners = [];
export function setTool(changes) {
    Object.assign(tools, changes);
    toolListeners.forEach((fn) => fn(tools));
}
export function onToolChange(fn) {
    toolListeners.push(fn);
}

// Selected whiteboard.
let selected = null;
const selectListeners = [];
export function selectedBoard() {
    return selected;
}
export function selectBoard(id) {
    if (!id || id === selected) return;
    selected = id;
    selectListeners.forEach((fn) => fn(id));
}
export function onSelect(fn) {
    selectListeners.push(fn);
}
