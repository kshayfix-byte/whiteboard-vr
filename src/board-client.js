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
