// Helpers shared by the 2D page and the VR page.

export const DEFAULT_BACKGROUND = '#EEF8FD';

export function normalizeRoom(room) {
    return room == null ? room : String(room).trim().toUpperCase();
}

export function clearCanvas(context2D, canvas, background) {
    context2D.fillStyle = background || DEFAULT_BACKGROUND;
    context2D.fillRect(0, 0, canvas.width, canvas.height);
}

function strokeLine(context2D, x0, y0, x1, y1, color, size) {
    context2D.beginPath();
    context2D.strokeStyle = color;
    context2D.lineJoin = 'round';
    context2D.lineCap = 'round';
    context2D.lineWidth = size;
    context2D.moveTo(x0, y0);
    context2D.lineTo(x1, y1);
    context2D.stroke();
}

// Draw a live `draw` message (the format clients send over the socket).
export function drawSegment(context2D, obj, background) {
    if (obj.lastX == null || obj.lastY == null) return;
    const color = obj.clearing ? (background || DEFAULT_BACKGROUND) : obj.color;
    strokeLine(context2D, obj.lastX, obj.lastY, obj.x, obj.y, color, obj.size);
}

// Draw one stored op from the server. Unknown op types are skipped so that
// adding new tools later won't break older pages.
export function renderOp(context2D, op, background) {
    if (!op) return;
    if (op.type === 'stroke') {
        const color = op.erase ? (background || DEFAULT_BACKGROUND) : op.color;
        strokeLine(context2D, op.x0, op.y0, op.x1, op.y1, color, op.size);
    }
}

// Redraw the whole board from a `boardState` message.
export function replayBoard(context2D, canvas, state) {
    clearCanvas(context2D, canvas, state.background);
    (state.ops || []).forEach((op) => renderOp(context2D, op, state.background));
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
