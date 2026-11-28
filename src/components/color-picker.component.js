import { useMarker, tools, onToolChange } from '../vr/session';
import { createLook } from '../vr/button-look';
import { watchTouch } from '../vr/reach';


AFRAME.registerComponent('color-picker', {
    schema: {
        color: {
            type: 'color',
            default: 'black'
        }
    },
    init: function () {

        this.el.sceneEl.addEventListener('camera-set-active', this.cameraSetActive.bind(this));

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.onClickPosition = new THREE.Vector2();

        this.renderer = this.el.sceneEl.renderer;

        this.el.sceneEl.addEventListener( 'mouseup', this.onMouseUp.bind(this), false );

        // Keeps its own colour when pointed at; the disc in use is a bit bigger
        // (see vr/button-look.js).
        this.look = createLook(this.el, { color: this.data.color, keepColor: true, activeGrow: 1.25 });
        // Point at it and pull the trigger (see vr/reach.js).
        this.touch = watchTouch(this.el, (controller) => {
            controller.setAttribute('line', {
                color: this.data.color
            });
            this.setColor()
            this.look.flash();
        });
        const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
        onToolChange(() => this.look.setActive(!tools.clearing && !tools.highlight && same(tools.color, this.data.color)));
        this.look.setActive(!tools.clearing && !tools.highlight && same(tools.color, this.data.color));
    },
    tick: function () {
        this.touch.tick();
    },
    setColor: function() {
        // Pen settings are shared by every whiteboard (see vr/session.js).
        // A colour always means the marker (as before the highlighter existed).
        useMarker(this.data.color);
    },
    onMouseUp: function(evt) {
        // Controllers also send mouseup events (with no position); only real mouse clicks count here.
        if (evt.clientX == null && !(evt.touches && evt.touches[0])) return;
        var array = this.getMousePosition( this.renderer.domElement, evt.clientX != null ? evt.clientX : evt.touches[0].clientX, evt.clientY != null ? evt.clientY : evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        if ( intersects.length > 0 ) {
            this.setColor()
        }
    },
    getMousePosition: function ( dom, x, y ) {

        var rect = this.renderer.domElement.getBoundingClientRect();
        return [ ( x - rect.left ) / rect.width, ( y - rect.top ) / rect.height ];

    },

    getIntersects: function ( point, objects ) {

        this.mouse.set( ( point.x * 2 ) - 1, - ( point.y * 2 ) + 1 );

        this.raycaster.setFromCamera( this.mouse, this.camera );

        return this.raycaster.intersectObjects( objects );

    },
    cameraSetActive: function() {
        this.camera = this.el.sceneEl.camera;
    }

  });