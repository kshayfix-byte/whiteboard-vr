import { tools, useEraser, onToolChange } from '../vr/session';
import { watchTouch } from '../vr/reach';

// An eraser box on the tool panel. Point at it and pull the trigger to pick
// up that eraser. There are two boxes (bug V8: one box that toggled between
// them could leave you stuck on the wrong one):
//   eraser-picker                       pink "Eraser": writing and highlights
//   eraser-picker="highlightsOnly: true" yellow "Erase highlights": highlights
//                                       only, writing stays
// Pressing a box again keeps the same eraser. The box of the eraser in use
// is a bit bigger.
const HIGHLIGHT_ERASER_COLOR = '#FFF176';


AFRAME.registerComponent('eraser-picker', {
    schema: {
        color: {
            type: 'color',
            default: 'pink'
        },
        clearing: {
            type: 'boolean',
            default: true
        },
        highlightsOnly: {
            type: 'boolean',
            default: false
        }
    },
    init: function () {


        this.el.sceneEl.addEventListener('camera-set-active', this.cameraSetActive.bind(this));

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.onClickPosition = new THREE.Vector2();

        this.renderer = this.el.sceneEl.renderer;

        this.el.sceneEl.addEventListener( 'mouseup', this.onMouseUp.bind(this), false );

        this.el.setAttribute('material', {
            color: this.boxColor()
        })
        this.baseScale = this.el.object3D.scale.clone();
        // Point at it and pull the trigger (see vr/reach.js).
        this.touch = watchTouch(this.el, (controller) => {
            this.activateEraser()
            controller.setAttribute('line', { color: this.boxColor() });
        });
        onToolChange(() => this.show());
        this.show();
    },
    tick: function () {
        this.touch.tick();
    },
    boxColor: function() {
        return this.data.highlightsOnly ? HIGHLIGHT_ERASER_COLOR : this.data.color;
    },
    activateEraser: function() {
        useEraser(this.boxColor(), this.data.highlightsOnly);
    },
    // The box of the eraser in use is a bit bigger.
    show: function() {
        const inUse = tools.clearing && !!tools.highlight === this.data.highlightsOnly;
        const k = inUse ? 1.3 : 1;
        if (this.baseScale) this.el.object3D.scale.set(this.baseScale.x * k, this.baseScale.y * k, this.baseScale.z);
    },
    onMouseUp: function(evt) {
        // Controllers also send mouseup events (with no position); only real mouse clicks count here.
        if (evt.clientX == null && !(evt.touches && evt.touches[0])) return;
        var array = this.getMousePosition( this.renderer.domElement, evt.clientX != null ? evt.clientX : evt.touches[0].clientX, evt.clientY != null ? evt.clientY : evt.touches[0].clientY );
        this.onClickPosition.fromArray( array );

        var intersects = this.getIntersects( this.onClickPosition, [this.el.getObject3D('mesh')] );

        if ( intersects.length > 0 ) {
            this.activateEraser()
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