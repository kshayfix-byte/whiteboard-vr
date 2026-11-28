// The laser line shows how far you can draw (round-2 notes, Q-12).
//
// The pointer always reaches LONG_REACH so the panel works from anywhere
// (see vr/reach.js). With Reach: 20 cm, when the first thing the pointer hits
// is a whiteboard further away than that, the line is cut to 20 cm so you can
// see the pen won't get there. Pointing at anything else, the line goes the
// full distance as usual.
//
// Put it after `raycaster` on the controller entity: components tick in the
// order they were added, so this runs after the raycaster has drawn its line
// for the frame.
import { reachMetres } from '../vr/reach';

function onBoard(el) {
    while (el && el.isEntity) {
        if (el.components && el.components['texture-painter']) return true;
        el = el.parentNode;
    }
    return false;
}

AFRAME.registerComponent('reach-line', {
    init: function () {
        this.end = new THREE.Vector3();
        this.cut = false;
    },
    tick: function () {
        const rc = this.el.components.raycaster;
        if (!rc || !rc.data.showLine || !rc.intersections) return;
        const first = rc.intersections.find((i) => i.object && i.object.el && i.object.el !== this.el);
        const reach = reachMetres();
        if (!first || first.distance <= reach || !onBoard(first.object.el)) {
            this.cut = false;
            return; // the raycaster's own line is right
        }
        const o = rc.data.origin;
        const d = rc.data.direction;
        this.end.set(o.x + d.x * reach, o.y + d.y * reach, o.z + d.z * reach);
        this.el.setAttribute('line', 'end', this.end);
        this.cut = true;
    }
});
