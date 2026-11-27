import { tools, useEraser, onToolChange } from '../vr/session';
import { watchTouch } from '../vr/reach';

// Touch the eraser box to pick up the eraser; touch it again to switch
// between the ordinary eraser (pink: writing and highlights) and the
// highlight eraser (yellow: highlights only, writing stays).
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
            color: this.data.color
        })
        // Touch it with the pointer (within 20 cm), or point and pull the
        // trigger from further away (see vr/reach.js).
        this.touch = watchTouch(this.el, (controller) => {
            this.activateEraser()
            controller.setAttribute('line', { color: tools.eraserColor || this.data.color });
        });
        onToolChange(() => this.show());
    },
    tick: function () {
        this.touch.tick();
    },
    activateEraser: function() {
        if (tools.clearing) {
            const hl = !tools.highlight;
            useEraser(hl ? HIGHLIGHT_ERASER_COLOR : this.data.color, hl);
        } else {
            useEraser(this.data.color, false);
        }
    },
    // Box colour and label show which eraser is picked up.
    show: function() {
        const hl = tools.clearing && tools.highlight;
        this.el.setAttribute('material', 'color', hl ? HIGHLIGHT_ERASER_COLOR : this.data.color);
        const label = document.getElementById('vr-eraser-label');
        if (label) label.setAttribute('value', hl ? 'Erase highlights' : 'Eraser');
    },
    onMouseUp: function(evt) {
        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
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