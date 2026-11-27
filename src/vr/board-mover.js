// Moving whiteboards around the VR room.
//
// In a headset: hold the grip button (the side button under the middle
// finger) on either controller.
// - Pointing at a board grabs that board (and selects it). Pointing at
//   nothing grabs the selected board.
// - While held, the board moves with the controller as if it were on the end
//   of a stick: swing the controller to move it around, raise or lower it to
//   change its height, turn it to turn the board. The board always stays
//   upright.
// - Thumbstick forward/back pushes the board away or pulls it closer;
//   thumbstick left/right turns it on the spot.
// - Let go of the grip to drop it there. Everyone in the room sees it move,
//   and its place is saved with the board.
//
// Without a headset the page's "Move board" panel nudges the selected board
// one step at a time (see nudge()).
//
// A moved board keeps its place ("pose") until someone presses "Auto place",
// which puts it back in the automatic layout.

import { clampPose, nudgePose } from './layout';

const SEND_EVERY_MS = 100;   // live updates while a board is held
const SMOOTHING = 0.35;      // 0..1 per frame; lower = steadier but laggier
const PUSH_SPEED = 1.2;      // thumbstick push/pull, fraction of the distance per second
const TURN_SPEED = 90;       // thumbstick turn, degrees per second
const DEADZONE = 0.2;
const MIN_REACH = 0.2;       // metres between the controller and a held board
const MAX_REACH = 30;
const GRAB_RANGE = 50;       // how far away a board can be pointed at

function yawOf(quaternion) {
    // Rotation about the vertical axis of something looking along -z.
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    return Math.atan2(-f.x, -f.z) * 180 / Math.PI;
}

function angleDiff(a, b) {
    return ((b - a + 540) % 360) - 180;
}

// options:
//   scene, socket, room
//   boardIds()            ids of the boards in the scene
//   entry(id)             the board's { root, plane, frame, pose } (see vr.js)
//   size(id)              the board's size in metres { w, h }
//   selected()            id of the selected board
//   select(id)
//   onLocalPose(id, pose) this page moved a board (pose null = auto place)
//   onHeldChange(id)      a board was grabbed (id) or dropped (null)
//   status(text, isError)
export function createBoardMover(options) {
    const { scene, socket, room } = options;
    let held = null;         // { id, controller, localPos, reach, ctrlYaw0, boardYaw0, turn, pose }
    let lastSent = 0;
    let lastSentPose = null;

    function send(id, pose, live) {
        lastSent = Date.now();
        lastSentPose = pose;
        socket.emit('moveBoard', { room: room, board: id, pose: pose, live: live }, (result) => {
            if (!live && !(result && result.ok)) options.status((result && result.error) || 'Could not move the board.', true);
        });
    }

    // ---- Headset: grab with the grip button ----

    function pointedBoard(controller) {
        const obj = controller.object3D;
        obj.updateMatrixWorld();
        const origin = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
        const q = new THREE.Quaternion();
        obj.getWorldQuaternion(q);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const ray = new THREE.Raycaster(origin, dir, 0, GRAB_RANGE);
        let best = null;
        options.boardIds().forEach((id) => {
            const e = options.entry(id);
            if (!e) return;
            const hits = ray.intersectObjects([e.plane.object3D, e.frame.object3D], true);
            if (hits.length && (!best || hits[0].distance < best.distance)) best = { id: id, distance: hits[0].distance };
        });
        return best && best.id;
    }

    function grab(controller) {
        if (held) return;
        const id = pointedBoard(controller) || options.selected();
        const e = id && options.entry(id);
        if (!e || !e.pose) return;
        if (id !== options.selected()) options.select(id);
        controller.object3D.updateMatrixWorld();
        const inv = new THREE.Matrix4();
        if (inv.invert) inv.copy(controller.object3D.matrixWorld).invert(); // newer three.js
        else inv.getInverse(controller.object3D.matrixWorld);
        const boardPos = new THREE.Vector3().fromArray(e.pose.position);
        const localPos = boardPos.clone().applyMatrix4(inv);
        const q = new THREE.Quaternion();
        controller.object3D.getWorldQuaternion(q);
        held = {
            id: id,
            controller: controller,
            localPos: localPos,
            reach: 1,
            ctrlYaw0: yawOf(q),
            boardYaw0: e.pose.rotationY || 0,
            turn: 0,
            stick: { x: 0, y: 0 },
            pose: { position: e.pose.position.slice(), rotationY: e.pose.rotationY || 0 }
        };
        lastSentPose = null;
        options.onHeldChange(id);
    }

    function release(controller) {
        if (!held || (controller && held.controller !== controller)) return;
        const done = held;
        held = null;
        if (!options.entry(done.id)) { options.onHeldChange(null); return; } // removed meanwhile
        const pose = clampPose(done.pose, options.size(done.id));
        options.onLocalPose(done.id, pose);
        send(done.id, pose, false);
        options.onHeldChange(null);
    }

    function update(dt) {
        if (!held) return;
        const e = options.entry(held.id);
        if (!e) { held = null; options.onHeldChange(null); return; }
        const ctrl = held.controller.object3D;
        ctrl.updateMatrixWorld();

        // Thumbstick: push/pull and turn.
        const sx = Math.abs(held.stick.x) > DEADZONE ? held.stick.x : 0;
        const sy = Math.abs(held.stick.y) > DEADZONE ? held.stick.y : 0;
        if (sy) {
            const len = held.localPos.length() || 1;
            const reach = held.reach * (1 - sy * PUSH_SPEED * dt); // stick forward is -y
            held.reach = Math.min(MAX_REACH / len, Math.max(MIN_REACH / len, reach));
        }
        if (sx) held.turn -= sx * TURN_SPEED * dt;

        const target = held.localPos.clone().multiplyScalar(held.reach).applyMatrix4(ctrl.matrixWorld);
        const q = new THREE.Quaternion();
        ctrl.getWorldQuaternion(q);
        const targetYaw = held.boardYaw0 + angleDiff(held.ctrlYaw0, yawOf(q)) + held.turn;

        // Smooth out hand shake, which a long reach makes much bigger.
        const p = held.pose.position;
        for (let i = 0; i < 3; i++) p[i] += (target.getComponent(i) - p[i]) * SMOOTHING;
        held.pose.rotationY += angleDiff(held.pose.rotationY, targetYaw) * SMOOTHING;
        const shown = clampPose(held.pose, options.size(held.id));
        held.pose = { position: shown.position.slice(), rotationY: held.pose.rotationY };

        e.root.object3D.position.fromArray(shown.position);
        e.root.object3D.rotation.set(0, shown.rotationY * Math.PI / 180, 0);
        e.pose = shown;

        if (Date.now() - lastSent >= SEND_EVERY_MS && JSON.stringify(shown) !== JSON.stringify(lastSentPose)) {
            send(held.id, shown, true);
        }
    }

    document.querySelectorAll('.controller').forEach((controller) => {
        controller.addEventListener('gripdown', () => grab(controller));
        controller.addEventListener('gripup', () => release(controller));
        controller.addEventListener('thumbstickmoved', (evt) => {
            if (held && held.controller === controller) held.stick = { x: evt.detail.x || 0, y: evt.detail.y || 0 };
        });
    });
    // Leaving VR while holding a board drops it where it is.
    scene.addEventListener('exit-vr', () => release(null));

    if (!AFRAME.components['board-mover-tick']) {
        AFRAME.registerComponent('board-mover-tick', {
            tick: function (time, delta) {
                if (this.el.boardMoverUpdate) this.el.boardMoverUpdate(Math.min(delta || 16, 100) / 1000);
            }
        });
    }
    scene.boardMoverUpdate = update;
    scene.setAttribute('board-mover-tick', '');

    // ---- Desktop buttons and "Auto place" ----

    function nudge(action, id) {
        id = id || options.selected();
        const e = id && options.entry(id);
        if (!e || !e.pose || held) return;
        const pose = nudgePose(e.pose, action, options.size(id));
        options.onLocalPose(id, pose);
        send(id, pose, false);
    }

    function autoPlace(id) {
        id = id || options.selected();
        if (!id || held) return;
        options.onLocalPose(id, null);
        send(id, null, false);
    }

    return {
        nudge: nudge,
        autoPlace: autoPlace,
        isHeld: (id) => !!held && held.id === id,
        holds: (controller) => !!held && held.controller === controller,
        heldId: () => (held ? held.id : null)
    };
}
