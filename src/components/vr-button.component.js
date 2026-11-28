import { nearestHit } from '../vr/reach';
import { createLook, COLORS } from '../vr/button-look';

// A button in the VR scene. Point at it and pull the trigger (or click it with
// the mouse outside VR) and it emits `vr-action` on the scene with its action,
// e.g. "save", "save-all" or "export". Set `enabled: false` to grey it out;
// pressing a grey button emits `vr-action-disabled` instead, so the page can
// say why it can't be used. `active: true` shows it in the active colour
// (a mode that is on). Colours and the press flash: see vr/button-look.js.
AFRAME.registerComponent('vr-button', {
    schema: {
        action: { type: 'string' },
        color: { type: 'color', default: COLORS.normal },
        enabled: { type: 'boolean', default: true },
        active: { type: 'boolean', default: false },
        cooldown: { type: 'int', default: 1500 } // ms between presses
    },
    init: function () {
        this.lastPress = 0;
        this.look = createLook(this.el, { color: this.data.color });

        document.querySelectorAll(".controller").forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                // Look past the panel's backing plate (see vr/reach.js).
                if (nearestHit(controller, this.el, true)) this.press();
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
        this.look.setColor(this.data.color);
        this.look.setEnabled(this.data.enabled);
        this.look.setActive(this.data.active);
    },
    press: function () {
        const now = Date.now();
        if (now - this.lastPress < this.data.cooldown) return; // one action per press
        this.lastPress = now;
        if (!this.data.enabled) {
            // A greyed-out button says why it can't be used (see vr.js), instead of doing nothing.
            this.el.sceneEl.emit('vr-action-disabled', { action: this.data.action });
            return;
        }
        this.look.flash();
        this.el.sceneEl.emit('vr-action', { action: this.data.action });
    }
});
