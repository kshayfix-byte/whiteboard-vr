import { setTool } from '../vr/session';


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

        this.el.setAttribute('material', {
            color: this.data.color
        })
        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;   
            this.raycasterObj.setAttribute('line', {
                color: this.data.color
            });
            this.setColor()
            
        });
    },
    setColor: function() {
        // Pen settings are shared by every whiteboard (see vr/session.js).
        setTool({ color: this.data.color, clearing: false });
    },
    onMouseUp: function(evt) {
        var array = this.getMousePosition( this.renderer.domElement, evt.clientX || evt.touches[0].clientX, evt.clientY || evt.touches[0].clientY );
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