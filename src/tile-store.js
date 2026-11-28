// A whiteboard's pixels, cut into tiles. Used by the 2D page and the VR page
// for every board, flat and 360-degree.
//
// Why tiles: a board is painted at 1000 pixels per metre, so a big board is a
// big picture. One canvas that size hits device limits (iPhone and iPad
// Safari can't draw a canvas over 16.7 million pixels, and some headset
// graphics chips can't show an image wider than 4096 px), and in VR every pen
// stroke used to re-send the whole picture to the graphics chip. Cut into
// strips TILE_WIDTH pixels wide, no single canvas is ever big, and a stroke
// only touches the one or two strips it crosses.
//
// Blank tiles cost (almost) nothing: until something is drawn on it, a tile's
// canvas is 1 x 1 pixel of the background colour, stretched to its place on
// screen (or as a VR texture). It gets its full size on the first stroke, and
// goes back to 1 x 1 when the board is erased. Most boards are mostly empty,
// so most of a big board never takes memory.
//
// Coordinates are always the whole board's canvas pixels; each tile shifts
// them into its own canvas. A 360-degree board's strokes may run past either
// edge (see wrapCopies in board-client.js); pass wrap: true for those.

import {
    DEFAULT_BACKGROUND, renderOp, drawSegment, opBounds, wrapCopies,
    useLayers, holdLayers, clearCanvas
} from './board-client.js';

export const TILE_WIDTH = 1000;
// Largest canvas iPhone / iPad Safari will draw (4096 x 4096 worth of pixels).
// Exports bigger than this are scaled down so they still work everywhere.
export const MAX_CANVAS_PIXELS = 16777216;

// Split a board `width` px wide into tile strips: [{ x0, width }, ...].
export function tileRanges(width, tileWidth) {
    const tw = tileWidth || TILE_WIDTH;
    const out = [];
    for (let x0 = 0; x0 < width; x0 += tw) out.push({ x0: x0, width: Math.min(tw, width - x0) });
    return out;
}

// The tiles (by index) that something spanning bounds touches.
export function tilesTouched(ranges, bounds, wrapWidth) {
    if (!bounds) return ranges.map((r, i) => i);
    const shifts = wrapCopies(bounds.minX, bounds.maxX, wrapWidth || 0);
    const out = [];
    ranges.forEach((t, i) => {
        if (shifts.some((dx) => bounds.minX + dx < t.x0 + t.width && bounds.maxX + dx > t.x0)) out.push(i);
    });
    return out;
}

// Size of a PNG export: the board's size, scaled down if it is too many
// pixels for some browsers. { width, height, scale }
export function exportSize(width, height, maxPixels) {
    const max = maxPixels || MAX_CANVAS_PIXELS;
    const scale = width * height > max ? Math.sqrt(max / (width * height)) : 1;
    return { width: Math.floor(width * scale), height: Math.floor(height * scale), scale: scale };
}

// options:
//   wrap:         true for a 360-degree board (strokes wrap round the join)
//   onTileChange: function (tile, resized) called after a tile's pixels
//                 change; resized is true when its canvas changed size (VR
//                 must then drop the old GPU copy)
//   makeCanvas:   function () returning a new canvas (tests / VR may pass one)
export function createTileStore(width, height, options) {
    const opts = options || {};
    const makeCanvas = opts.makeCanvas || (() => document.createElement('canvas'));
    const changed = opts.onTileChange || function () {};
    let background = DEFAULT_BACKGROUND;
    let tiles = [];

    function blank(tile) {
        // 1 x 1 pixel of background: frees the full-size canvas and its layers.
        const resized = tile.live || tile.canvas.width !== 1 || tile.canvas.height !== 1;
        tile.canvas.width = 1;
        tile.canvas.height = 1;
        tile.live = false;
        clearCanvas(tile.context2D, tile.canvas, background);
        changed(tile, resized);
    }

    function wake(tile) {
        if (tile.live) return;
        tile.canvas.width = tile.width;
        tile.canvas.height = store.height;
        tile.live = true;
        useLayers(tile.canvas);   // highlights under ink (see board-client.js)
        clearCanvas(tile.context2D, tile.canvas, background);
        if (store.holding) holdLayers(tile.canvas, true);
        tile.resizedSinceUpdate = true;
    }

    function build(w, h) {
        store.width = w;
        store.height = h;
        tiles = tileRanges(w).map((r, i) => {
            const canvas = makeCanvas();
            const tile = { index: i, x0: r.x0, width: r.width, canvas: canvas, context2D: canvas.getContext('2d'), live: false };
            return tile;
        });
        store.tiles = tiles;
        tiles.forEach(blank);
    }

    // Draw with draw(context2D) on every tile something with `bounds` touches.
    // An eraser stroke over a blank tile changes nothing, so it stays blank.
    function paint(bounds, draw, isErase) {
        tilesTouched(tiles, bounds, opts.wrap ? store.width : 0).forEach((i) => {
            const t = tiles[i];
            if (!t.live) {
                if (isErase) return;
                wake(t);
            }
            t.context2D.save();
            t.context2D.translate(-t.x0, 0);
            draw(t.context2D);
            t.context2D.restore();
            if (!store.holding) {
                changed(t, !!t.resizedSinceUpdate);
                t.resizedSinceUpdate = false;
            } else {
                t.touched = true;
            }
        });
    }

    const store = {
        width: width,
        height: height,
        tiles: tiles,
        holding: false,
        background: function () { return background; },
        // Erase everything (and free the memory of every tile).
        clear: function (bg) {
            background = bg || background;
            tiles.forEach(blank);
        },
        // Give the board a new size (wipes it; redraw with replay()).
        resize: function (w, h) {
            if (w === store.width && h === store.height) return false;
            tiles.forEach((t) => { t.canvas.width = 0; t.canvas.height = 0; });
            if (opts.onRebuild) opts.onRebuild(tiles);
            build(w, h);
            return true;
        },
        // A live `draw` message.
        drawSegment: function (obj) {
            if (obj.lastX == null || obj.lastY == null) return;
            paint(opBounds(obj), (ctx) => drawSegment(ctx, obj, background, opts.wrap ? store.width : 0), !!obj.clearing);
        },
        // Redraw the whole board from a `boardState` message.
        replay: function (state) {
            background = state.background || DEFAULT_BACKGROUND;
            tiles.forEach((t) => { if (t.live) blank(t); else clearCanvas(t.context2D, t.canvas, background); });
            store.holding = true;
            (state.ops || []).forEach((op) => {
                paint(opBounds(op), (ctx) => renderOp(ctx, op, background, opts.wrap ? store.width : 0),
                    op && op.type === 'stroke' && !!op.erase);
            });
            store.holding = false;
            tiles.forEach((t) => {
                if (!t.live) return;
                holdLayers(t.canvas, false);
                if (t.touched || t.resizedSinceUpdate) changed(t, !!t.resizedSinceUpdate);
                t.touched = false;
                t.resizedSinceUpdate = false;
            });
        },
        // Draw the board (or the part from board x `fromX`, `w` wide) onto
        // ctx at dx, dy, scaled by `scale`. Blank tiles come out as background.
        drawTo: function (ctx, dx, dy, scale, fromX, w) {
            const s = scale || 1;
            const x0 = fromX || 0;
            const x1 = x0 + (w == null ? store.width : w);
            tiles.forEach((t) => {
                const a = Math.max(x0, t.x0);
                const b = Math.min(x1, t.x0 + t.width);
                if (b <= a) return;
                if (t.live) {
                    ctx.drawImage(t.canvas, a - t.x0, 0, b - a, store.height,
                        dx + (a - x0) * s, dy, (b - a) * s, store.height * s);
                } else {
                    ctx.fillStyle = background;
                    ctx.fillRect(dx + (a - x0) * s, dy, (b - a) * s, store.height * s);
                }
            });
        },
        // The whole board as one canvas, for exporting. Scaled down if it is
        // too big for some browsers (see exportSize).
        toCanvas: function () {
            const size = exportSize(store.width, store.height);
            const out = makeCanvas();
            out.width = size.width;
            out.height = size.height;
            const ctx = out.getContext('2d');
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, out.width, out.height);
            store.drawTo(ctx, 0, 0, size.scale);
            return out;
        },
        // How many tiles hold full-size pixels (the rest are blank).
        liveTiles: function () {
            return tiles.filter((t) => t.live).length;
        },
        // Point on tile `index` at texture position (u, v) (0..1, v up, as
        // three.js gives it) in board pixels.
        pointOnTile: function (index, u, v) {
            const t = tiles[index];
            if (!t) return null;
            return { x: t.x0 + u * t.width, y: (1 - v) * store.height };
        },
        dispose: function () {
            tiles.forEach((t) => { t.canvas.width = 0; t.canvas.height = 0; });
        }
    };

    build(width, height);
    return store;
}
