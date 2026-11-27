// One whiteboard in the VR scene. Each board entity has its own canvas
// (texture) and listens only to drawings for its own board id. Pen settings
// are shared by all boards (see ../vr/session.js).
import {
    DEFAULT_BACKGROUND, normalizeRoom, clearCanvas, drawSegment, replayBoard,
    exportFilename, downloadCanvas, sizeCanvas
} from '../board-client';
import { socket, room, tools, selectBoard } from '../vr/session';

AFRAME.registerComponent('texture-painter', {
    schema: {
        board: { type: 'string', default: 'main' },
        width: { type: 'int', default: 1500 },
        height: { type: 'int', default: 1000 }
    },
    init: function () {

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

        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;
            this.hoverSelected = false; // tick() selects once the hit is confirmed
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.lastX = null;
            this.lastY = null;
            this.raycasterObj = null;
        });

        var controllers = document.querySelectorAll(".controller");
        controllers.forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                this.triggerdown = true;
            });
            controller.addEventListener('triggerup', evt => {
                this.triggerdown = false;
            });
        })
        

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

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.onClickPosition = new THREE.Vector2();

        this.renderer = this.el.sceneEl.renderer;

        this.parentTexture = planeTexture;
        this._parentTexture = [];

        this._canvas = document.createElement( "canvas" );
        this._canvas.width = this.data.width;
        this._canvas.height = this.data.height;
        this._context2D = this._canvas.getContext( "2d" );
    
        this.parentTexture.image = this._canvas;

        // draw background
        clearCanvas(this._context2D, this._canvas, this.background);

        this.parentTexture.needsUpdate = true;

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

    },
    remove: function () {
        socket.off('remoteDraw', this.onRemoteDraw);
        socket.off('remoteEraseAll', this.onRemoteEraseAll);
    },
    mine: function (obj) {
        return obj && room == normalizeRoom(obj.room) && (obj.board || 'main') === this.boardId;
    },
    // The board was resized: give the canvas the new size (this wipes it;
    // loadState() redraws it right after) and re-upload the texture.
    resize: function (width, height) {
        if (!sizeCanvas(this._canvas, width, height)) return;
        this.lastX = null;
        this.lastY = null;
        clearCanvas(this._context2D, this._canvas, this.background);
        this.parentTexture.dispose(); // the GPU copy has the old size
        this.parentTexture.needsUpdate = true;
    },
    loadState: function (state) {
        if (state.width && state.height) this.resize(state.width, state.height);
        this.background = state.background || DEFAULT_BACKGROUND;
        replayBoard(this._context2D, this._canvas, state);
        this.parentTexture.needsUpdate = true;
        this.boardName = state.name || '';
        this.loaded = true;
    },
    drawRemote: function(remoteDrawObject) {
        if (!this.mine(remoteDrawObject)) {
            return;
        }
        if (remoteDrawObject.lastX != null && remoteDrawObject.lastY != null) {
            drawSegment(this._context2D, remoteDrawObject, this.background);
            this.parentTexture.needsUpdate = true;
        }
    },
    setBoardName: function(name) {
        this.boardName = name || '';
    },
    // Download the board as a PNG via the browser's normal download.
    exportImage: function() {
        downloadCanvas(this._canvas, exportFilename(this.boardName, room));
    },
    eraseAllRemote: function(remoteEraseAllObject) {
        if (!this.mine(remoteEraseAllObject)) {
            return;
        }
        clearCanvas(this._context2D, this._canvas, this.background);
        this.parentTexture.needsUpdate = true;
    },
    tick: function () {
        if (!this.raycasterObj) { return; }  // Not intersecting.
    
        let intersection = this.raycasterObj.components.raycaster.getIntersection(this.el);
        if (!intersection) { return; }
        // Pointing a controller at a board selects it. (Checked here rather
        // than on raycaster-intersected, which also fires for a moment while
        // new boards are still at the origin.)
        if (!this.hoverSelected && this.el.sceneEl.is('vr-mode')) {
            this.hoverSelected = true;
            selectBoard(this.boardId);
        }
        if (this.triggerdown) {
            selectBoard(this.boardId);
            var uv = intersection.uv;
            var x = uv.x;
            var y = 1 - uv.y;
            this._draw( x * this._canvas.width, y * this._canvas.height);
            this.lastX = x * this._canvas.width;
            this.lastY = y * this._canvas.height;
        } else {
            this.lastX = null;
            this.lastY = null;
        }
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
    _draw: function (x, y) {
        // Don't draw until the saved board has loaded, so nothing gets painted over.
        if (this.loaded && this.lastX != null && this.lastY != null) {
            var drawObject= {};
            drawObject.id = this.id;
            drawObject.lastX = this.lastX;
            drawObject.lastY = this.lastY;
            drawObject.x = x;
            drawObject.y = y;
            drawObject.color = tools.color;
            drawObject.room = room;
            drawObject.board = this.boardId;
            drawObject.size = Number(tools.size);
            drawObject.clearing = tools.clearing;
            drawObject.bw = this._canvas.width;   // board size this stroke was drawn on
            drawObject.bh = this._canvas.height;
            socket.emit('draw', drawObject);
            this.drawRemote(drawObject);
            this.lastX = x;
            this.lastY = y;
        }
    },

    onMouseMove: function ( evt ) {

        evt.preventDefault();

        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        if ( intersects.length > 0 && intersects[ 0 ].uv ) {

            var uv = intersects[ 0 ].uv;
            intersects[ 0 ].object.material.map.transformUv( uv );
            this._draw( uv.x * this._canvas.width, uv.y * this._canvas.height);
        }

    },
    onMouseDown: function(evt) {
        //evt.preventDefault();

        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        if ( intersects.length > 0 && intersects[ 0 ].uv ) {

            selectBoard(this.boardId);
            this.disableLookControls();

            var uv = intersects[ 0 ].uv;
            intersects[ 0 ].object.material.map.transformUv( uv );

            this.lastX = uv.x * this._canvas.width;
            this.lastY = uv.y * this._canvas.height;

        }
    },
    onMouseUp: function (evt) {
        //evt.preventDefault();
        this.lastX = null;
        this.lastY = null;

        this.enableLookControls();
    },

    getMousePosition: function ( dom, x, y ) {

        var rect = this.renderer.domElement.getBoundingClientRect();
        return [ ( x - rect.left ) / rect.width, ( y - rect.top ) / rect.height ];

    },

    getIntersects: function ( point, objects ) {

        this.mouse.set( ( point.x * 2 ) - 1, - ( point.y * 2 ) + 1 );

        this.raycaster.setFromCamera( this.mouse, this.camera );

        return this.raycaster.intersectObjects( objects );

    }

  });