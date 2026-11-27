// A button in the VR scene. Point at it and pull the trigger (or click it with
// the mouse outside VR) and it emits `vr-action` on the scene with its action,
// e.g. "save", "save-all" or "export". Set `enabled: false` to grey it out.
AFRAME.registerComponent('vr-button', {
    schema: {
        action: { type: 'string' },
        color: { type: 'color', default: '#03B594' },
        enabled: { type: 'boolean', default: true },
        cooldown: { type: 'int', default: 1500 } // ms between presses
    },
    init: function () {
        this.lastPress = 0;
        this.hovered = false;

        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;
            this.hovered = true;
            this.paint();
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.raycasterObj = null;
            this.hovered = false;
            this.paint();
        });

        document.querySelectorAll(".controller").forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                if (this.raycasterObj) this.press();
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
            if (this.raycaster.intersectObject(this.el.object3D, true).length > 0) this.press();
        });
    },
    update: function () {
        this.paint();
    },
    paint: function () {
        let color = this.data.color;
        if (!this.data.enabled) color = '#9A9A9A';
        else if (this.hovered) color = '#FFFFFF';
        this.el.setAttribute('material', { color: color, opacity: this.data.enabled ? 1 : 0.5, transparent: !this.data.enabled });
    },
    press: function () {
        if (!this.data.enabled) return;
        const now = Date.now();
        if (now - this.lastPress < this.data.cooldown) return; // one action per press
        this.lastPress = now;
        this.el.sceneEl.emit('vr-action', { action: this.data.action });
    }
});
