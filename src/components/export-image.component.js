// In-VR "Export image" button: point at it and pull the trigger to download
// the board as a PNG. Desktop users can also click it with the mouse.
AFRAME.registerComponent('export-image', {
    schema: {
        color: { type: 'color', default: '#03B594' }
    },
    init: function () {
        this.texturePainter = document.querySelector("[texture-painter]");
        this.lastExport = 0;
        this.el.setAttribute('material', { color: this.data.color });

        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;
            this.el.setAttribute('material', { color: '#5EE6C9' });
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.raycasterObj = null;
            this.el.setAttribute('material', { color: this.data.color });
        });

        document.querySelectorAll(".controller").forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                if (this.raycasterObj) this.exportNow();
            });
        });

        // Mouse click in the non-immersive view.
        this.el.sceneEl.addEventListener('camera-set-active', () => {
            this.camera = this.el.sceneEl.camera;
        });
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.el.sceneEl.addEventListener('mouseup', evt => {
            if (!this.camera || evt.clientX == null) return;
            const rect = this.el.sceneEl.renderer.domElement.getBoundingClientRect();
            this.mouse.set(((evt.clientX - rect.left) / rect.width) * 2 - 1,
                -((evt.clientY - rect.top) / rect.height) * 2 + 1);
            this.raycaster.setFromCamera(this.mouse, this.camera);
            if (this.raycaster.intersectObject(this.el.object3D, true).length > 0) this.exportNow();
        });
    },
    exportNow: function () {
        const now = Date.now();
        if (now - this.lastExport < 2000) return; // one download per press
        this.lastExport = now;
        const painter = this.texturePainter && this.texturePainter.components['texture-painter'];
        if (painter) painter.exportImage();
        this.el.setAttribute('material', { color: 'white' });
        setTimeout(() => this.el.setAttribute('material', { color: this.data.color }), 300);
    }
});
