// Shows where the pointer meets a whiteboard: a see-through dot the size of
// the pen (or eraser) tip. From further away a ring around the dot is added,
// growing with the distance, so you can still see where you'd draw on a far
// board. Only shown on the first thing the pointer hits.
import { nearestHit, NEAR_REACH, canDrawAt } from '../vr/reach';

const RING_PER_METRE = 0.012;   // ring radius per metre of distance

AFRAME.registerComponent('intersection-visual', {
    schema: {
        size: {
            type: "number",
            default: 10
        },
        color: {
            type: "color",
            default: "black"
        }
    },
    init: function () {

        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            if (this.raycasterObj && evt.detail.el !== this.raycasterObj) return; // the other controller
            this.raycasterObj = null;
            this.hide();
        });

        // Unit ring, scaled to the distance in tick().
        this.ring = new THREE.Mesh(
            new THREE.RingBufferGeometry(0.8, 1, 32),
            new THREE.MeshBasicMaterial({ color: this.data.color, opacity: 0.8, transparent: true, depthTest: false })
        );
        this.ring.renderOrder = 10;
        this.ring.visible = false;
        this.el.sceneEl.object3D.add(this.ring);
        this.normal = new THREE.Vector3();
        this.quat = new THREE.Quaternion();
    },
    update: function() {
        if (this.mesh) this.el.sceneEl.object3D.remove(this.mesh);
        this.geometry = new THREE.SphereBufferGeometry(0.0005 * this.data.size);
        this.material = new THREE.MeshBasicMaterial({color: this.data.color, opacity: 0.5, transparent: true});
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.mesh.position.set(0, -1, 0);
        this.el.sceneEl.object3D.add(this.mesh);
        if (this.ring) this.ring.material.color.set(this.data.color);
    },
    remove: function () {
        // The marker lives on the scene, so take it away with its board.
        this.el.sceneEl.object3D.remove(this.mesh);
        this.el.sceneEl.object3D.remove(this.ring);
    },
    hide: function () {
        this.mesh.position.set(0, -1, 0);
        this.ring.visible = false;
    },
    tick: function () {
        if (!this.raycasterObj) { return; }  // Not intersecting.

        let intersection = nearestHit(this.raycasterObj, this.el);
        // No pen marker on parts you can't draw on (the outside of a 360-degree board).
        if (!intersection || intersection.object.userData.noPen) { this.hide(); return; }
        // Out of reach (Reach: 20 cm): no pen dot, so you can see it won't draw.
        if (!canDrawAt(intersection.distance)) { this.hide(); return; }
        const p = intersection.point;
        this.mesh.position.set(p.x, p.y, p.z);

        if (intersection.distance > NEAR_REACH * 2 && intersection.face) {
            // Lie flat on the board, just in front of it.
            this.normal.copy(intersection.face.normal).transformDirection(intersection.object.matrixWorld);
            this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
            this.ring.quaternion.copy(this.quat);
            this.ring.position.set(p.x, p.y, p.z).addScaledVector(this.normal, 0.002);
            const r = Math.max(0.0005 * this.data.size * 1.6, intersection.distance * RING_PER_METRE);
            this.ring.scale.set(r, r, r);
            this.ring.visible = true;
        } else {
            this.ring.visible = false;
        }
    },

  });
