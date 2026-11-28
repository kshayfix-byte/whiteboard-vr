// One whiteboard in the VR scene. Each board entity has its own canvas
// (texture) and listens only to drawings for its own board id. Pen settings
// are shared by all boards (see ../vr/session.js).
//
// shape "flat": the entity is an a-plane and this component paints its
// texture. shape "cylinder": a 360-degree board; this component builds the
// wall itself (see ../vr/wrap-surface.js), and strokes may cross the join
// between the canvas's left and right edges.
import {
    DEFAULT_BACKGROUND, normalizeRoom, clearCanvas, drawSegment, replayBoard,
    exportFilename, downloadCanvas, sizeCanvas, unwrapX, useLayers
} from '../board-client';
import { socket, room, tools, selectBoard } from '../vr/session';
import { nearestHit, canDrawAt } from '../vr/reach';
import { createWrapSurface } from '../vr/wrap-surface';

// Drawing from far away: hand shake grows with distance, so strokes drawn
// from more than STEADY_FROM metres are smoothed a little (more the further
// away). Close up, strokes follow the pointer exactly, as before.
const STEADY_FROM = 0.5;
const MIN_FOLLOW = 0.3;  // fraction of the way to the pointer per frame, at most smoothing

AFRAME.registerComponent('texture-painter', {
    schema: {
        board: { type: 'string', default: 'main' },
        width: { type: 'int', default: 1500 },
        height: { type: 'int', default: 1000 },
        shape: { type: 'string', default: 'flat' }
    },
    init: function () {
        this.wrapBoard = this.data.shape === 'cylinder';

        this.id = Math.floor(Math.random() * 100000000);
        this.boardId = this.data.board;
        this.background = DEFAULT_BACKGROUND;
        this.boardName = '';
        this.loaded = false;

        this.el.sceneEl.addEventListener('camera-set-active', this.cameraSetActive.bind(this));
        this.camera = this.el.sceneEl.camera; // boards added later miss the event above
        this.el.sceneEl.addEventListener( 'mousemove', this.onMouseMove.bind(this), false );
        this.el.sceneEl.addEventListener( 'touchmove', this.onMouseMove.bind(this), false );
        this.el.sceneEl.addEventListener( 'mouseup', this.onMouseUp.bind(this), false );
        this.el.sceneEl.addEventListener( 'touchend', this.onMouseUp.bind(this), false );
        this.el.sceneEl.addEventListener( 'mousedown', this.onMouseDown.bind(this), false );
        this.el.sceneEl.addEventListener( 'touchstart', this.onMouseDown.bind(this), false );

        // Each controller (and the mouse) draws its own stroke: where it last
        // drew on this board, or null when it isn't drawing here. A pen that
        // leaves the board ends its stroke, and coming back starts a new one,
        // so no straight line joins the two spots (bug 34). Before, both
        // controllers shared one stroke and one trigger flag.
        this.pens = new Map();
        this.pointers = new Set();   // controllers whose ray touches this board
        this.down = new Set();       // controllers with the trigger held
        this.el.addEventListener('raycaster-intersected', evt => {
            this.pointers.add(evt.detail.el);
            this.hoverSelected = false; // tick() selects once the hit is confirmed
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.pointers.delete(evt.detail.el);
            this.endStroke(evt.detail.el);
        });

        var controllers = document.querySelectorAll(".controller");
        controllers.forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                this.down.add(controller);
                this.endStroke(controller); // a new pull is a new stroke
            });
            controller.addEventListener('triggerup', evt => {
                this.down.delete(controller);
                this.endStroke(controller);
            });
        })
        

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.onClickPosition = new THREE.Vector2();
        this.renderer = this.el.sceneEl.renderer;

        // The board manager (vr.js) joins the room and passes this board's
        // state in with loadState(). Live strokes come straight from the socket.
        this.onRemoteDraw = (obj) => {
            if (obj.id != this.id) this.drawRemote(obj);
        };
        this.onRemoteEraseAll = (obj) => {
            if (obj.id != this.id) this.eraseAllRemote(obj);
        };
        socket.on('remoteDraw', this.onRemoteDraw);
        socket.on('remoteEraseAll', this.onRemoteEraseAll);

        if (this.wrapBoard) {
            this.surface = createWrapSurface(this.data.width, this.data.height);
            this.surface.clear(this.background);
            this.el.setObject3D('mesh', this.surface.group);
            this.ready = true;
            return;
        }

        // Clamp + linear filtering without mipmaps lets the texture keep the
        // canvas's real size. (With the original repeat wrapping, three.js
        // shrank every board to a power of two, e.g. 1500x1000 to 1024x1024,
        // which would make large boards blurry.) Boards bigger than the GPU's
        // largest texture are still scaled down by three.js.
        var planeTexture = new THREE.Texture( undefined, THREE.UVMapping, THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
            THREE.LinearFilter, THREE.LinearFilter );
        planeTexture.generateMipmaps = false;
        this.planeMaterial = new THREE.MeshPhongMaterial( { map: planeTexture, shininess: 50 } );
        // The mesh may not exist yet when the board is created from code.
        const useMaterial = () => {
            this.mesh = this.el.getObject3D('mesh');
            if (this.mesh) this.mesh.material = this.planeMaterial;
        };
        useMaterial();
        this.el.addEventListener('object3dset', (evt) => { if (evt.detail.type === 'mesh') useMaterial(); });

        this.parentTexture = planeTexture;
        this._parentTexture = [];

        this._canvas = document.createElement( "canvas" );
        this._canvas.width = this.data.width;
        this._canvas.height = this.data.height;
        useLayers(this._canvas);   // highlights under ink (see board-client.js)
        this._context2D = this._canvas.getContext( "2d" );
    
        this.parentTexture.image = this._canvas;

        // draw background
        clearCanvas(this._context2D, this._canvas, this.background);

        this.parentTexture.needsUpdate = true;
        this.ready = true;
    },
    remove: function () {
        socket.off('remoteDraw', this.onRemoteDraw);
        socket.off('remoteEraseAll', this.onRemoteEraseAll);
        if (this.surface) {
            this.el.removeObject3D('mesh');
            this.surface.dispose();
        }
    },
    // Size of the board's canvas in pixels.
    boardWidth: function () {
        return this.surface ? this.surface.width : this._canvas.width;
    },
    boardHeight: function () {
        return this.surface ? this.surface.height : this._canvas.height;
    },
    // Canvas point { x, y } for a pointer hit on this board, or null.
    pointFromHit: function (hit) {
        if (!hit) return null;
        if (this.surface) return this.surface.pointFromHit(hit);
        if (!hit.uv) return null;
        return { x: hit.uv.x * this._canvas.width, y: (1 - hit.uv.y) * this._canvas.height };
    },
    mine: function (obj) {
        return obj && room == normalizeRoom(obj.room) && (obj.board || 'main') === this.boardId;
    },
    // The board was resized: give the canvas the new size (this wipes it;
    // loadState() redraws it right after) and re-upload the texture.
    resize: function (width, height) {
        if (this.surface) return; // 360-degree boards have a fixed size
        if (!sizeCanvas(this._canvas, width, height)) return;
        this.pens.clear();
        clearCanvas(this._context2D, this._canvas, this.background);
        this.parentTexture.dispose(); // the GPU copy has the old size
        this.parentTexture.needsUpdate = true;
    },
    loadState: function (state) {
        this.pens.clear();
        this.background = state.background || DEFAULT_BACKGROUND;
        if (this.surface) {
            this.surface.replay(state);
        } else {
            if (state.width && state.height) this.resize(state.width, state.height);
            replayBoard(this._context2D, this._canvas, state);
            this.parentTexture.needsUpdate = true;
        }
        this.boardName = state.name || '';
        this.loaded = true;
    },
    drawRemote: function(remoteDrawObject) {
        if (!this.mine(remoteDrawObject)) {
            return;
        }
        if (remoteDrawObject.lastX == null || remoteDrawObject.lastY == null) return;
        if (this.surface) {
            this.surface.drawSegment(remoteDrawObject);
        } else {
            drawSegment(this._context2D, remoteDrawObject, this.background);
            this.parentTexture.needsUpdate = true;
        }
    },
    setBoardName: function(name) {
        this.boardName = name || '';
    },
    // Download the board as a PNG via the browser's normal download.
    // A 360-degree board exports as one wide panorama.
    exportImage: function() {
        const canvas = this.surface ? this.surface.toCanvas() : this._canvas;
        downloadCanvas(canvas, exportFilename(this.boardName, room));
    },
    eraseAllRemote: function(remoteEraseAllObject) {
        if (!this.mine(remoteEraseAllObject)) {
            return;
        }
        if (this.surface) {
            this.surface.clear(this.background);
            return;
        }
        clearCanvas(this._context2D, this._canvas, this.background);
        this.parentTexture.needsUpdate = true;
    },
    // Where `key` (a controller, or 'mouse') last drew on this board.
    pen: function (key) {
        if (!this.pens.has(key)) this.pens.set(key, { lastX: null, lastY: null });
        return this.pens.get(key);
    },
    endStroke: function (key) {
        const p = this.pens.get(key);
        if (p) { p.lastX = null; p.lastY = null; }
    },
    tick: function () {
        if (!this.pointers.size) { this.hoverSelected = false; return; }  // Not intersecting.
        this.pointers.forEach((controller) => this.tickPen(controller));
    },
    tickPen: function (controller) {
        const pen = this.pen(controller);
        // Only the first thing the pointer hits counts, so a long pointer
        // can't draw on a board hidden behind this one (or behind a button).
        let intersection = nearestHit(controller, this.el);
        if (!intersection) {
            this.endStroke(controller);
            return;
        }
        // Pointing a controller at a board selects it. (Checked here rather
        // than on raycaster-intersected, which also fires for a moment while
        // new boards are still at the origin.)
        if (!this.hoverSelected && this.el.sceneEl.is('vr-mode')) {
            this.hoverSelected = true;
            selectBoard(this.boardId);
        }
        const point = this.pointFromHit(intersection);
        // No point: e.g. the outside of a 360-degree board. Out of reach: the
        // Reach setting only limits drawing (bug V9). Either way the stroke ends.
        if (!point || !this.down.has(controller) || !canDrawAt(intersection.distance)) {
            this.endStroke(controller);
            return;
        }
        selectBoard(this.boardId);
        var x = this.wrapX(point.x, pen);
        var y = point.y;
        if (pen.lastX != null && intersection.distance > STEADY_FROM) {
            var follow = Math.max(MIN_FOLLOW, STEADY_FROM / intersection.distance);
            x = pen.lastX + (x - pen.lastX) * follow;
            y = pen.lastY + (y - pen.lastY) * follow;
        }
        this._draw(x, y, pen);
        pen.lastX = x;
        pen.lastY = y;
    },
    // On a 360-degree board, keep x next to the stroke's last point (see unwrapX).
    wrapX: function (x, pen) {
        return this.surface ? unwrapX(x, pen && pen.lastX, this.surface.width) : x;
    },
    cameraSetActive: function() {
        this.camera = this.el.sceneEl.camera;
    },
    disableLookControls: function() {
        if (this.camera.el) {
            this.camera.el.setAttribute('look-controls', {
                enabled: false
            })
        }
    },
    enableLookControls: function() {
        if (this.camera.el) {
            this.camera.el.setAttribute('look-controls', {
                enabled: true
            })
        }
    },
    eraseAll: function () {
        var eraseAllObject = {};
        eraseAllObject.room = room;
        eraseAllObject.board = this.boardId;
        eraseAllObject.id = this.id;
        socket.emit('eraseAll', eraseAllObject);
        this.eraseAllRemote(eraseAllObject);
    },
    // A line from where `pen` last drew to (x, y). The pen's first point
    // only starts the stroke.
    _draw: function (x, y, pen) {
        // Don't draw until the saved board has loaded, so nothing gets painted over.
        if (this.loaded && pen.lastX != null && pen.lastY != null) {
            var drawObject= {};
            drawObject.id = this.id;
            drawObject.lastX = pen.lastX;
            drawObject.lastY = pen.lastY;
            drawObject.x = x;
            drawObject.y = y;
            drawObject.color = tools.color;
            drawObject.room = room;
            drawObject.board = this.boardId;
            drawObject.size = Number(tools.size);
            drawObject.clearing = tools.clearing;
            drawObject.highlight = !!tools.highlight;   // with clearing: the highlight eraser
            drawObject.bw = this.boardWidth();   // board size this stroke was drawn on
            drawObject.bh = this.boardHeight();
            socket.emit('draw', drawObject);
            this.drawRemote(drawObject);
        }
        pen.lastX = x;
        pen.lastY = y;
    },

    onMouseMove: function ( evt ) {

        evt.preventDefault();

        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        var point = intersects.length > 0 && !this.panelInFront(intersects[ 0 ]) && this.pointFromHit(intersects[ 0 ]);
        var pen = this.pen('mouse');
        if ( !point ) {
            // Off the board: the stroke ends here (bug 34).
            pen.lastX = null;
            pen.lastY = null;
        } else if ( this.mouseHeld ) {
            // Still holding the button: draw, or start a new stroke if the
            // mouse just came back onto the board.
            this._draw( this.wrapX(point.x, pen), point.y, pen );
        }

    },
    onMouseDown: function(evt) {
        //evt.preventDefault();

        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        var point = intersects.length > 0 && !this.panelInFront(intersects[ 0 ]) && this.pointFromHit(intersects[ 0 ]);
        if ( point ) {

            selectBoard(this.boardId);
            this.disableLookControls();

            this.mouseHeld = true;
            var pen = this.pen('mouse');
            pen.lastX = point.x;
            pen.lastY = point.y;

        }
    },
    onMouseUp: function (evt) {
        //evt.preventDefault();
        this.endStroke('mouse');
        this.mouseHeld = false;

        this.enableLookControls();
    },

    // Mouse (outside a headset): is the tool panel between the camera and
    // this hit? Then the click is for the panel, not the board. Uses the ray
    // getIntersects() just set up.
    panelInFront: function (hit) {
        const panel = document.getElementById('tool-panel');
        if (!panel) return false;
        const hits = this.raycaster.intersectObject(panel.object3D, true);
        return hits.length > 0 && hits[0].distance < hit.distance;
    },

    getMousePosition: function ( dom, x, y ) {

        var rect = this.renderer.domElement.getBoundingClientRect();
        return [ ( x - rect.left ) / rect.width, ( y - rect.top ) / rect.height ];

    },

    getIntersects: function ( point, objects ) {

        this.mouse.set( ( point.x * 2 ) - 1, - ( point.y * 2 ) + 1 );

        this.raycaster.setFromCamera( this.mouse, this.camera );

        return this.raycaster.intersectObjects( objects, true );

    }

  });