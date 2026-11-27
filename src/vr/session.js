// State shared by everything in the VR page: the socket, the room, the
// current drawing tool (shared by every whiteboard), and which whiteboard is
// selected (the one Save, Rename, Export and Erase All act on).
import io from 'socket.io-client';
import { normalizeRoom, HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_SIZE } from '../board-client';

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

// Pen settings, the same for every whiteboard. `color` and `size` are those
// of the pen in use: the marker, or the highlighter when `highlight` is on.
// `clearing` = the eraser (it uses the marker's size, as before);
// `clearing` + `highlight` = the highlight eraser (the highlighter's size).
export const tools = { color: '#000000', size: 10, clearing: false, highlight: false };

// Each pen remembers its own colour and size while the other is in use.
const pens = {
    marker: { color: '#000000', size: 10 },
    highlighter: { color: HIGHLIGHT_COLORS[0], size: DEFAULT_HIGHLIGHT_SIZE }
};

const toolListeners = [];
export function setTool(changes) {
    Object.assign(tools, changes);
    // The highlight eraser (clearing + highlight) uses the highlighter's size.
    const p = tools.highlight ? pens.highlighter : pens.marker;
    if (!tools.clearing) p.color = tools.color;
    p.size = tools.size;
    toolListeners.forEach((fn) => fn(tools));
}

// Marker in `color` (or its last colour).
export function useMarker(color) {
    setTool({ clearing: false, highlight: false, color: color || pens.marker.color, size: pens.marker.size });
}

// Highlighter in `color` (or its last colour).
export function useHighlighter(color) {
    setTool({ clearing: false, highlight: true, color: color || pens.highlighter.color, size: pens.highlighter.size });
}

export function highlighterColor() {
    return pens.highlighter.color;
}

// The eraser; with highlightsOnly, the highlight eraser (rubs out
// highlights and leaves the writing).
export function useEraser(eraserColor, highlightsOnly) {
    const p = highlightsOnly ? pens.highlighter : pens.marker;
    setTool({ clearing: true, highlight: !!highlightsOnly, eraserColor: eraserColor, color: p.color, size: p.size });
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
