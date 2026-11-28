// The highlighter on the VR tool panel: a see-through box in the
// highlighter's colour. Pointing at it and pulling the trigger picks up the
// highlighter; doing it again while it is in use moves on to the next
// highlighter colour (yellow, green, pink, blue, orange). The colour
// cylinders go back to the marker, and the eraser box to the eraser.
import { tools, useHighlighter, highlighterColor, onToolChange } from '../vr/session';
import { watchTouch } from '../vr/reach';
import { HIGHLIGHT_COLORS } from '../board-client';

AFRAME.registerComponent('highlighter-picker', {
    init: function () {
        this.el.sceneEl.addEventListener('camera-set-active', () => { this.camera = this.el.sceneEl.camera; });
        this.camera = this.el.sceneEl.camera;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.renderer = this.el.sceneEl.renderer;
        this.el.sceneEl.addEventListener('mouseup', this.onMouseUp.bind(this), false);

        this.touch = watchTouch(this.el, (controller) => {
            this.pick();
            controller.setAttribute('line', { color: tools.color });
        });
        this.show();
        onToolChange(() => this.show());
    },
    tick: function () {
        this.touch.tick();
    },
    pick: function () {
        if (tools.highlight && !tools.clearing) {
            const i = HIGHLIGHT_COLORS.indexOf(highlighterColor());
            useHighlighter(HIGHLIGHT_COLORS[(i + 1) % HIGHLIGHT_COLORS.length]);
        } else {
            useHighlighter();
        }
    },
    // Box colour = the highlighter's colour; a bit more solid while in use.
    show: function () {
        const active = tools.highlight && !tools.clearing;
        this.el.setAttribute('material', {
            color: highlighterColor(),
            transparent: true,
            opacity: active ? 0.85 : 0.5
        });
    },
    onMouseUp: function (evt) {
        if (!this.camera || !this.renderer) return;
        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = evt.clientX || (evt.touches && evt.touches[0] && evt.touches[0].clientX);
        const y = evt.clientY || (evt.touches && evt.touches[0] && evt.touches[0].clientY);
        if (x == null || y == null) return;
        this.mouse.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const mesh = this.el.getObject3D('mesh');
        if (mesh && this.raycaster.intersectObject(mesh).length > 0) this.pick();
    }
});
