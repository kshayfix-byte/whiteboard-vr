// Helpers shared by the 2D page and the VR page.

export const DEFAULT_BACKGROUND = '#EEF8FD';

export function normalizeRoom(room) {
    return room == null ? room : String(room).trim().toUpperCase();
}

export function clearCanvas(context2D, canvas, background) {
    context2D.fillStyle = background || DEFAULT_BACKGROUND;
    context2D.fillRect(0, 0, canvas.width, canvas.height);
}

function strokeLine(context2D, x0, y0, x1, y1, color, size, highlight) {
    context2D.save();
    // Highlighter: see highlightTint() below.
    context2D.globalCompositeOperation = highlight ? 'darken' : 'source-over';
    context2D.beginPath();
    context2D.strokeStyle = color;
    context2D.lineJoin = 'round';
    context2D.lineCap = 'round';
    context2D.lineWidth = size;
    context2D.moveTo(x0, y0);
    context2D.lineTo(x1, y1);
    context2D.stroke();
    context2D.restore();
}

// ---- Highlighter ----
// A highlighter stroke should look like one see-through layer of colour,
// even though it arrives as many short overlapping segments. Drawing each
// segment with ordinary transparency would make dark blotches wherever two
// segments (or the round ends of two segments) overlap.
//
// Instead a highlight is drawn in an opaque "tint": the highlighter colour
// mixed with the board's background at HIGHLIGHT_ALPHA, which is exactly what
// a see-through highlight looks like on an empty part of the board. It is
// drawn with the canvas's "darken" mode, which keeps the darker of the tint
// and what is already there, colour channel by colour channel. So:
// - on bare board it shows the tint, and drawing over it again changes
//   nothing (no blotches, any number of overlapping segments = one layer);
// - writing under it stays visible (black stays black, blue ink goes a
//   deeper blue under yellow, like a real highlighter on paper);
// - two different highlighter colours over each other mix (yellow + pink
//   gives orange), but the same colour twice doesn't get darker;
// - it doesn't matter which order things are drawn in, so live drawing,
//   redrawing a saved board, the 360-degree tiles and PNG export all match;
// - the eraser (which paints the background) removes highlights and ink alike.
// Marker ink drawn on top of a highlight later covers it, as before.
export const HIGHLIGHT_ALPHA = 0.5;          // guess: how strong a highlight looks
export const HIGHLIGHT_COLORS = ['#FFEB3B', '#76FF03', '#FF4FA3', '#40C4FF', '#FF9100'];
export const HIGHLIGHT_NAMES = ['yellow', 'green', 'pink', 'blue', 'orange'];
export const DEFAULT_HIGHLIGHT_SIZE = 30;

function parseHex(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    if (h.length !== 6 || isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The opaque colour a highlight in `color` shows on an empty board.
export function highlightTint(color, background) {
    const c = parseHex(color) || [255, 235, 59];
    const b = parseHex(background || DEFAULT_BACKGROUND) || [255, 255, 255];
    const mix = c.map((v, i) => Math.round(b[i] + (v - b[i]) * HIGHLIGHT_ALPHA));
    return 'rgb(' + mix.join(',') + ')';
}

// ---- 360-degree (wraparound) boards ----
// A wraparound board's canvas is the inside of a cylinder unrolled: its left
// and right edges are the same place. Strokes may use x values past either
// edge (a stroke that crosses the join keeps going), so everything drawn on
// such a board goes through wrapCopies(): it is drawn once where it is and
// once a full turn to each side, and the canvas clips what falls outside.
// New op types (text labels, highlighter) should draw through wrapCopies()
// too, so they also work across the join.

// The x shifts to draw something spanning minX..maxX at on a board that wraps
// every `wrap` pixels (0 or missing = a flat board: just [0]).
export function wrapCopies(minX, maxX, wrap) {
    if (!wrap) return [0];
    const base = -Math.floor(minX / wrap) * wrap; // brings minX into 0..wrap
    return [base - wrap, base, base + wrap];
}

// Bring an x drawn while moving round a wraparound board next to the
// previous point, so a stroke over the join doesn't jump across the board.
export function unwrapX(x, lastX, wrap) {
    if (!wrap || lastX == null) return x;
    while (x - lastX > wrap / 2) x -= wrap;
    while (x - lastX < -wrap / 2) x += wrap;
    return x;
}

function strokeWrapped(context2D, x0, y0, x1, y1, color, size, wrap, highlight) {
    wrapCopies(Math.min(x0, x1), Math.max(x0, x1), wrap).forEach((dx) => {
        strokeLine(context2D, x0 + dx, y0, x1 + dx, y1, color, size, highlight);
    });
}

// The colour (and mode) to paint a stroke with. The eraser wins over the highlighter.
function strokePaint(erase, highlight, color, background) {
    if (erase) return { color: background || DEFAULT_BACKGROUND, highlight: false };
    if (highlight) return { color: highlightTint(color, background), highlight: true };
    return { color: color, highlight: false };
}

// Draw a live `draw` message (the format clients send over the socket).
// `wrap` is the board width for wraparound boards, otherwise leave it out.
export function drawSegment(context2D, obj, background, wrap) {
    if (obj.lastX == null || obj.lastY == null) return;
    const paint = strokePaint(obj.clearing, obj.highlight, obj.color, background);
    strokeWrapped(context2D, obj.lastX, obj.lastY, obj.x, obj.y, paint.color, obj.size, wrap, paint.highlight);
}

// Draw one stored op from the server. Unknown op types are skipped so that
// adding new tools later won't break older pages.
export function renderOp(context2D, op, background, wrap) {
    if (!op) return;
    if (op.type === 'stroke') {
        // Highlighter strokes are strokes with highlight: true (older pages
        // that don't know the flag draw them as ordinary marker strokes).
        const paint = strokePaint(op.erase, op.highlight, op.color, background);
        strokeWrapped(context2D, op.x0, op.y0, op.x1, op.y1, paint.color, op.size, wrap, paint.highlight);
    }
}

// The area an op or live draw message covers: { minX, maxX, minY, maxY }, or
// null for types this page doesn't know. Used to redraw only the parts of a
// wraparound board that changed.
export function opBounds(op) {
    if (!op) return null;
    if (op.type === 'stroke' || op.type == null) {
        const x0 = op.type ? op.x0 : op.lastX;
        const y0 = op.type ? op.y0 : op.lastY;
        const x1 = op.type ? op.x1 : op.x;
        const y1 = op.type ? op.y1 : op.y;
        if (x0 == null || y0 == null) return null;
        const r = (Number(op.size) || 0) / 2 + 2;
        return { minX: Math.min(x0, x1) - r, maxX: Math.max(x0, x1) + r, minY: Math.min(y0, y1) - r, maxY: Math.max(y0, y1) + r };
    }
    return null;
}

// Redraw the whole board from a `boardState` message.
export function replayBoard(context2D, canvas, state) {
    clearCanvas(context2D, canvas, state.background);
    const wrap = isWrapBoard(state) ? canvas.width : 0;
    (state.ops || []).forEach((op) => renderOp(context2D, op, state.background, wrap));
}

export function exportFilename(name, room) {
    const base = (name || ('whiteboard-' + (room || 'board')))
        .replace(/[^A-Za-z0-9 _-]+/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'whiteboard';
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        '_' + pad(d.getHours()) + pad(d.getMinutes());
    return base + '_' + stamp + '.png';
}

// Download the canvas as a PNG through the browser's normal download flow.
export function downloadCanvas(canvas, filename) {
    const save = (url, revoke) => {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (revoke) setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
    if (canvas.toBlob) {
        canvas.toBlob((blob) => {
            if (blob) save(URL.createObjectURL(blob), true);
            else save(canvas.toDataURL('image/png'), false);
        }, 'image/png');
    } else {
        save(canvas.toDataURL('image/png'), false);
    }
}

export function formatDate(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString();
    } catch (e) {
        return iso;
    }
}

// ---- Board size ----
// Every board has the same pixel density: 1000 canvas pixels = 1 metre in VR
// (the pen sizes and the VR pen marker assume this). The server keeps the
// same limits (lib/board-store.js).
export const PX_PER_METRE = 1000;
export const DEFAULT_WIDTH = 1500;
export const DEFAULT_HEIGHT = 1000;
export const SIZE_LIMITS = { minWidth: 500, maxWidth: 4000, minHeight: 500, maxHeight: 2500 };

// Ready-made sizes, in pixels. The VR "Board size" button steps through them.
export const BOARD_SIZES = [
    { id: 'standard', label: 'Standard', width: 1500, height: 1000 },
    { id: 'wide', label: 'Wide', width: 3000, height: 1000 },
    { id: 'large', label: 'Large', width: 2500, height: 1500 },
    { id: 'wall', label: 'Wall', width: 4000, height: 2000 },
    { id: 'tall', label: 'Tall', width: 1000, height: 2000 }
];

export function metres(px) {
    return Math.round(px / PX_PER_METRE * 100) / 100;
}

// "1.5 × 1 m"
export function describeSize(width, height) {
    return metres(width || DEFAULT_WIDTH) + ' × ' + metres(height || DEFAULT_HEIGHT) + ' m';
}

export function presetFor(width, height) {
    return BOARD_SIZES.find((s) => s.width === width && s.height === height) || null;
}

// Make a canvas match a board size. Changing a canvas's size wipes it, so
// only do it when the size really changed. Returns true if it changed.
export function sizeCanvas(canvas, width, height) {
    width = width || DEFAULT_WIDTH;
    height = height || DEFAULT_HEIGHT;
    if (canvas.width === width && canvas.height === height) return false;
    canvas.width = width;
    canvas.height = height;
    return true;
}

// ---- Board shapes ----
// "flat" boards are ordinary rectangles. "cylinder" boards are 360-degree
// wraparound boards: the inside of a cylinder you stand in. They have a fixed
// size: WRAP_WIDTH pixels all the way round (8 m, so about 1.27 m from the
// middle to the wall) and WRAP_HEIGHT high. The server keeps the same
// numbers (lib/board-store.js).
export const WRAP_WIDTH = 8000;
export const WRAP_HEIGHT = 1800;

export function isWrapBoard(board) {
    return !!board && board.shape === 'cylinder';
}

// "8 m around × 1.8 m high"
export function describeWrapSize(width, height) {
    return metres(width || WRAP_WIDTH) + ' m around \u00d7 ' + metres(height || WRAP_HEIGHT) + ' m high';
}
