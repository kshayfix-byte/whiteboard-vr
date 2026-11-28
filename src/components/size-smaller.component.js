// The round "-" next to "Pen size": makes the pen in use thinner (to 5 px).
// The "+" is size-bigger.component.js. Point at it and pull the trigger.
import { tools, setTool } from '../vr/session';
import { watchTouch } from '../vr/reach';
import { createLook } from '../vr/button-look';

export function penSizeButton(name, step) {
    AFRAME.registerComponent(name, {
        init: function () {
            this.look = createLook(this.el);
            const change = () => {
                setTool({ size: Math.min(50, Math.max(5, tools.size + step)) });
                this.look.flash();
            };
            this.touch = watchTouch(this.el, change);
            // Mouse click outside a headset (bug 33: these never had one).
            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2();
            this.el.sceneEl.addEventListener('mouseup', (evt) => {
                const scene = this.el.sceneEl;
                if (evt.clientX == null || !scene.camera || scene.is('vr-mode')) return;
                const rect = scene.renderer.domElement.getBoundingClientRect();
                mouse.set(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1);
                raycaster.setFromCamera(mouse, scene.camera);
                if (raycaster.intersectObject(this.el.object3D, true).length > 0) change();
            });
        }
    });
}

penSizeButton('size-smaller', -10);
