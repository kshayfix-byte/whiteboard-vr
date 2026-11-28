// The "Pen mode" button on the VR tool panel (Kate, 2026-11-28; it was the
// Highlighter box). Each trigger pull moves on one step:
//   Dry erase -> Highlighter, yellow -> green -> pink -> blue -> orange -> Dry erase
// "Dry erase" is the marker, used with the colour discs. Picking a colour disc
// while highlighting goes back to Dry erase (color-picker.component.js). With
// an eraser in use, a pull goes back to Dry erase.
import { tools, useHighlighter, useMarker, highlighterColor, onToolChange } from '../vr/session';
import { watchTouch } from '../vr/reach';
import { createLook } from '../vr/button-look';
import { HIGHLIGHT_COLORS, HIGHLIGHT_NAMES } from '../board-client';

// "Dry erase", "Highlighter, yellow", ... or "Eraser" / "Erase highlights".
export function penModeName(t) {
    if (t.clearing) return t.highlight ? 'Erase highlights' : 'Eraser';
    if (!t.highlight) return 'Dry erase';
    const name = HIGHLIGHT_NAMES[HIGHLIGHT_COLORS.indexOf(t.color)];
    return 'Highlighter' + (name ? ', ' + name : '');
}

AFRAME.registerComponent('highlighter-picker', {
    init: function () {
        this.el.sceneEl.addEventListener('camera-set-active', () => { this.camera = this.el.sceneEl.camera; });
        this.camera = this.el.sceneEl.camera;
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.renderer = this.el.sceneEl.renderer;
        this.el.sceneEl.addEventListener('mouseup', this.onMouseUp.bind(this), false);

        this.look = createLook(this.el);
        this.touch = watchTouch(this.el, (controller) => {
            this.pick();
            this.look.flash();
            controller.setAttribute('line', { color: tools.color });
        });
        this.show();
        onToolChange(() => this.show());
    },
    tick: function () {
        this.touch.tick();
    },
    pick: function () {
        if (tools.clearing) {
            useMarker();
        } else if (tools.highlight) {
            const i = HIGHLIGHT_COLORS.indexOf(highlighterColor());
            if (i + 1 < HIGHLIGHT_COLORS.length) useHighlighter(HIGHLIGHT_COLORS[i + 1]);
            else useMarker();
        } else {
            useHighlighter(HIGHLIGHT_COLORS[0]);
        }
    },
    // The label says which pen is in use. Active colour while highlighting.
    show: function () {
        this.look.setActive(tools.highlight && !tools.clearing);
        const label = document.getElementById('vr-highlighter-label');
        if (label) label.setAttribute('value', 'Pen mode:\n' + penModeName(tools));
    },
    onMouseUp: function (evt) {
        // The scene's camera at the time of the click (the one saved at start
        // could be A-Frame's stand-in camera, so clicks missed).
        this.camera = this.el.sceneEl.camera || this.camera;
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
