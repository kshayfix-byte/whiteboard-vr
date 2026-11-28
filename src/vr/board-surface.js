// The drawing surface of a whiteboard in VR: the board's pixels cut into
// tiles (see ../tile-store.js), each tile shown as its own mesh with its own
// texture. A stroke only re-uploads the one or two tiles it touches, no
// texture is ever wider than TILE_WIDTH (many headsets stop at 4096 px), and
// blank tiles are a 1 x 1 pixel texture.
//
// Flat boards (createFlatSurface): the tiles are flat strips side by side,
// shown on top of the board's a-plane. The a-plane itself stays as the
// (invisible) thing the pointer hits, so pointer, grabbing and sizing work as
// before; a hit's uv on the plane gives the board pixel.
//
// 360-degree boards (createWrapSurface): the board is the inside of a
// cylinder you stand in. Canvas x runs left to right as seen from inside, all
// the way round. The middle of the canvas (x = width / 2) is straight ahead of
// the board's "front" (its local -z, like a flat board), so the join between
// the left and right edges is behind you when you face the front. From
// outside, a plain grey shell hides the inside and blocks the pointer, so
// nobody draws on the far wall through the near one.

import { PX_PER_METRE } from '../board-client';
import { createTileStore, TILE_WIDTH } from '../tile-store';

export { TILE_WIDTH };
const SEGMENTS_PER_TILE = 16;     // 128 flat facets round a 360-degree wall
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
function wrapTileGeometry(x0, tileWidth, width, radius, h) {
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

// A texture that keeps the canvas's real size: clamp + linear filtering, no
// mipmaps (three.js would otherwise shrink it to a power of two).
function tileTexture(canvas) {
    const texture = new THREE.Texture(canvas, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
        THREE.LinearFilter, THREE.LinearFilter);
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

// Shared by both shapes: a tile store whose tiles each get a mesh from
// makeMesh(tile, texture), kept in `group`.
function tiledSurface(width, height, wrap, makeMesh) {
    const group = new THREE.Group();
    let meshes = [];
    let store = null;

    function onTileChange(tile, resized) {
        const m = meshes[tile.index];
        if (!m) return;
        // A canvas that changed size needs a fresh GPU copy (the old one has
        // the old size).
        if (resized) m.material.map.dispose();
        m.material.map.needsUpdate = true;
    }

    function buildMeshes() {
        meshes.forEach((m) => {
            group.remove(m);
            m.material.map.dispose();
            m.material.dispose();
            m.geometry.dispose();
        });
        meshes = store.tiles.map((tile) => {
            const mesh = makeMesh(tile, tileTexture(tile.canvas), store);
            mesh.userData.boardTile = tile.index;
            group.add(mesh);
            return mesh;
        });
    }

    meshes = [];
    store = createTileStore(width, height, { wrap: wrap, onTileChange: onTileChange });
    buildMeshes();

    return {
        group: group,
        store: store,
        get width() { return store.width; },
        get height() { return store.height; },
        clear: (bg) => store.clear(bg),
        drawSegment: (obj) => store.drawSegment(obj),
        replay: (state) => store.replay(state),
        toCanvas: () => store.toCanvas(),
        // Returns true if the size changed (the board is then blank).
        resize: function (w, h) {
            if (!store.resize(w, h)) return false;
            buildMeshes();
            return true;
        },
        dispose: function () {
            meshes.forEach((m) => {
                m.material.map.dispose();
                m.material.dispose();
                m.geometry.dispose();
            });
            store.dispose();
        }
    };
}

// A flat board's tiles, centred on the board's a-plane (in its local space,
// metres). Add `group` to the plane entity's object3D.
export function createFlatSurface(width, height) {
    const surface = tiledSurface(width, height, false, (tile, texture, store) => {
        const w = tile.width / PX_PER_METRE;
        const h = store.height / PX_PER_METRE;
        const mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(w, h),
            new THREE.MeshPhongMaterial({ map: texture, shininess: 50 }));
        mesh.position.set((tile.x0 + tile.width / 2 - store.width / 2) / PX_PER_METRE, 0, 0);
        // The a-plane underneath takes the pointer hits (see top of file).
        mesh.raycast = function () {};
        return mesh;
    });
    // Board pixel for a pointer hit on the a-plane (uv 0..1 across the board).
    surface.pointFromHit = function (hit) {
        if (!hit || !hit.uv) return null;
        return { x: hit.uv.x * surface.width, y: (1 - hit.uv.y) * surface.height };
    };
    return surface;
}

export function createWrapSurface(width, height) {
    const { radius, h } = wrapMetres(width, height);
    const surface = tiledSurface(width, height, true, (tile, texture, store) => {
        // Unlit, so the wall is evenly bright wherever it stands in the room.
        const mesh = new THREE.Mesh(wrapTileGeometry(tile.x0, tile.width, store.width, radius, h),
            new THREE.MeshBasicMaterial({ map: texture }));
        mesh.userData.wrapTile = tile.index;
        return mesh;
    });

    // Outer shell (faces outwards, so it is invisible and can't be hit from inside).
    const shell = new THREE.Mesh(
        new THREE.CylinderBufferGeometry(radius + SHELL_GAP, radius + SHELL_GAP, h + 0.02, 64, 1, true),
        new THREE.MeshLambertMaterial({ color: SHELL_COLOR })
    );
    shell.userData.noPen = true;
    surface.group.add(shell);

    surface.radius = radius;
    surface.resize = function () { return false; };   // 360-degree boards have a fixed size
    // Canvas point { x, y } where a pointer ray hit the wall, or null if it
    // hit the outer shell (or anything else).
    surface.pointFromHit = function (hit) {
        const i = hit && hit.object && hit.object.userData.wrapTile;
        if (i == null || !hit.uv) return null;
        return surface.store.pointOnTile(i, hit.uv.x, hit.uv.y);
    };
    const dispose = surface.dispose;
    surface.dispose = function () {
        dispose();
        shell.geometry.dispose();
        shell.material.dispose();
    };
    return surface;
}
