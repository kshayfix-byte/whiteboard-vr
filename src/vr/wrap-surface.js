// The drawing surface of a 360-degree ("cylinder") whiteboard in VR.
//
// The board is the inside of a cylinder you stand in. Its canvas is far too
// wide for one texture (8000 px; many headsets stop at 4096), and uploading a
// texture that big on every pen stroke would be slow, so it is cut into
// tiles: each tile is a strip of the wall TILE_WIDTH pixels wide with its own
// canvas and texture. A stroke only re-uploads the one or two tiles it
// touches.
//
// Canvas x runs left to right as seen from inside, all the way round. The
// middle of the canvas (x = width / 2) is straight ahead of the board's
// "front" (its local -z, like a flat board), so the join between the left
// and right edges is behind you when you face the front.
//
// From outside, a plain grey shell hides the inside and blocks the pointer,
// so nobody draws on the far wall through the near one.

import {
    PX_PER_METRE, DEFAULT_BACKGROUND, renderOp, drawSegment, opBounds, wrapCopies,
    useLayers, holdLayers, clearCanvas
} from '../board-client';

export const TILE_WIDTH = 1000;
const SEGMENTS_PER_TILE = 16;     // 128 flat facets round the whole wall
const SHELL_GAP = 0.03;           // metres between the wall and the outer shell
const SHELL_COLOR = '#8f9aa6';

// Radius and height of the wall in metres.
export function wrapMetres(width, height) {
    return {
        radius: width / PX_PER_METRE / (2 * Math.PI),
        h: height / PX_PER_METRE
    };
}

function setAttr(geometry, name, attr) {
    if (geometry.setAttribute) geometry.setAttribute(name, attr);
    else geometry.addAttribute(name, attr); // older three.js
}

// One strip of the wall, facing inwards, covering canvas x0 .. x0 + tileWidth.
function tileGeometry(x0, tileWidth, width, radius, h) {
    const n = SEGMENTS_PER_TILE;
    const pos = [];
    const normal = [];
    const uv = [];
    const index = [];
    for (let j = 0; j <= n; j++) {
        const x = x0 + tileWidth * j / n;
        const a = (x / width - 0.5) * 2 * Math.PI;   // 0 = straight ahead, + = to the right
        const sx = Math.sin(a);
        const cz = -Math.cos(a);
        // bottom then top
        pos.push(radius * sx, -h / 2, radius * cz, radius * sx, h / 2, radius * cz);
        normal.push(-sx, 0, -cz, -sx, 0, -cz);
        uv.push(j / n, 0, j / n, 1);
    }
    for (let j = 0; j < n; j++) {
        const a = j * 2;          // bottom left
        const b = (j + 1) * 2;    // bottom right
        const c = b + 1;          // top right
        const d = a + 1;          // top left
        index.push(a, b, c, a, c, d);   // counter-clockwise seen from inside
    }
    const g = new THREE.BufferGeometry();
    setAttr(g, 'position', new THREE.Float32BufferAttribute(pos, 3));
    setAttr(g, 'normal', new THREE.Float32BufferAttribute(normal, 3));
    setAttr(g, 'uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
}

export function createWrapSurface(width, height) {
    const { radius, h } = wrapMetres(width, height);
    const group = new THREE.Group();
    const tiles = [];
    let background = DEFAULT_BACKGROUND;

    for (let x0 = 0; x0 < width; x0 += TILE_WIDTH) {
        const tw = Math.min(TILE_WIDTH, width - x0);
        const canvas = document.createElement('canvas');
        canvas.width = tw;
        canvas.height = height;
        useLayers(canvas);   // highlights under ink (see board-client.js)
        const texture = new THREE.Texture(canvas, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
            THREE.LinearFilter, THREE.LinearFilter);
        texture.generateMipmaps = false;
        // Unlit, so the wall is evenly bright wherever it stands in the room.
        const material = new THREE.MeshBasicMaterial({ map: texture });
        const mesh = new THREE.Mesh(tileGeometry(x0, tw, width, radius, h), material);
        mesh.userData.wrapTile = tiles.length;
        group.add(mesh);
        tiles.push({ x0: x0, width: tw, canvas: canvas, context2D: canvas.getContext('2d'), texture: texture, mesh: mesh });
    }

    // Outer shell (faces outwards, so it is invisible and can't be hit from inside).
    const shell = new THREE.Mesh(
        new THREE.CylinderBufferGeometry(radius + SHELL_GAP, radius + SHELL_GAP, h + 0.02, 64, 1, true),
        new THREE.MeshLambertMaterial({ color: SHELL_COLOR })
    );
    shell.userData.noPen = true;
    group.add(shell);

    function fill(tile) {
        clearCanvas(tile.context2D, tile.canvas, background);
        tile.texture.needsUpdate = true;
    }

    // Tiles that something spanning bounds (canvas pixels, any x) touches.
    function tilesFor(bounds) {
        if (!bounds) return tiles;
        const shifts = wrapCopies(bounds.minX, bounds.maxX, width);
        return tiles.filter((t) => shifts.some((dx) =>
            bounds.minX + dx < t.x0 + t.width && bounds.maxX + dx > t.x0));
    }

    // Run draw(context2D) on every tile in `list`, in board coordinates.
    function onTiles(list, draw) {
        list.forEach((t) => {
            t.context2D.save();
            t.context2D.translate(-t.x0, 0);
            draw(t.context2D);
            t.context2D.restore();
            t.texture.needsUpdate = true;
        });
    }

    return {
        group: group,
        width: width,
        height: height,
        radius: radius,
        clear: function (bg) {
            background = bg || background;
            tiles.forEach(fill);
        },
        drawSegment: function (obj) {
            onTiles(tilesFor(opBounds(obj)), (ctx) => drawSegment(ctx, obj, background, width));
        },
        replay: function (state) {
            background = state.background || DEFAULT_BACKGROUND;
            tiles.forEach((t) => {
                clearCanvas(t.context2D, t.canvas, background);
                holdLayers(t.canvas, true);
            });
            (state.ops || []).forEach((op) => {
                onTiles(tilesFor(opBounds(op)), (ctx) => renderOp(ctx, op, background, width));
            });
            tiles.forEach((t) => {
                holdLayers(t.canvas, false);
                t.texture.needsUpdate = true;
            });
        },
        // Canvas point { x, y } where a pointer ray hit the wall, or null if it
        // hit the outer shell (or anything else).
        pointFromHit: function (hit) {
            const i = hit && hit.object && hit.object.userData.wrapTile;
            if (i == null || !hit.uv) return null;
            const t = tiles[i];
            return { x: t.x0 + hit.uv.x * t.width, y: (1 - hit.uv.y) * height };
        },
        // The whole wall as one panorama canvas (for exporting).
        toCanvas: function () {
            const out = document.createElement('canvas');
            out.width = width;
            out.height = height;
            const ctx = out.getContext('2d');
            tiles.forEach((t) => ctx.drawImage(t.canvas, t.x0, 0));
            return out;
        },
        dispose: function () {
            tiles.forEach((t) => {
                t.texture.dispose();
                t.mesh.geometry.dispose();
                t.mesh.material.dispose();
            });
            shell.geometry.dispose();
            shell.material.dispose();
        }
    };
}
