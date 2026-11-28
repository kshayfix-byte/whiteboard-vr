// Where the VR tool panel (colours, sizes, eraser, Save, board buttons, ...)
// sits while you move around.
//
// The panel is one tilted plate, like a lectern, below your line of sight
// so the whiteboard stays visible above it (it used to be a frame around the
// first board, which a bigger or nearer board covered: bugs V1 to V5).
//
// Three ways, switched with the "Panel" button on the panel (the choice is
// remembered on this device):
//
// - Follow (default): the panel floats in front of you, FORWARD metres
//   ahead and DROP metres below your eyes. It stays still while
//   you look around and only glides back in front of you when you turn well
//   away from it (more than TURN_AWAY degrees for a moment) or move more than
//   MOVE_AWAY metres from it (after a teleport, for example). It never moves
//   while you are drawing, pressing a button, holding a whiteboard or
//   pointing at the panel, so it can't slide out from under the pointer.
// - Wrist: a small copy of the panel rides on your left hand like a palette.
//   Point at it with the right controller (or touch it with the right
//   controller's tip). Outside VR, or before the left controller is seen,
//   it stays where it is.
// - Stay: the panel stays wherever it is in the room (the original
//   behaviour, at the start spot until you bring it somewhere else).
//
// In Follow and Stay, the top face button on either controller (B or Y,
// or the menu button on other controllers) brings the panel in front of you
// straight away.
//
// Grip (bug V6): point at the panel (the dark handle on top, or anywhere on
// the plate) and hold the grip button to carry it. It keeps facing you.
// Let go and it stays there: the mode becomes Stay.
//
// The panel is an entity in the room (not inside the rig), so "Stay" is
// simply "don't move it". Its children are laid out in vr.html around the
// middle of the plate, facing +z.
//
// Outside VR the panel always goes back to the start spot, where the
// original desktop view expects it.

const MODES = ['follow', 'wrist', 'stay'];
const STORE_KEY = 'whiteboard-vr-panel';

const TURN_AWAY = 30;        // degrees between where you look and the panel before it follows (was 65)
const TURN_WAIT = 0.3;       // ...for this many seconds (was 0.6)
const MOVE_AWAY = 1.0;       // metres you can move away before it follows
const GLIDE = 0.25;          // seconds, roughly, for it to glide into place

// Where the panel goes in front of you (guesses, to tune on a headset).
export const FORWARD = 0.75;     // metres ahead of your eyes (level), to the middle of the plate (was 0.55: too close, Q-01)
export const DROP = 0.55;        // metres below your eyes
export const TILT = 48;          // degrees the plate leans back (top away), so it faces your eyes
const LOWEST = 0.55;             // the middle of the plate never goes lower than this above the floor
const DESKTOP_HEAD = { x: 0, y: 1.3, z: 0.1, yaw: 0 };   // the camera outside VR (see locomotion.js)
const DESKTOP_EXTRA = 0.5;       // metres further away outside a headset...
const DESKTOP_DROP = 0.4;        // ...and this far below the eyes, so the mouse view shows all of it

const MIN_HOLD = 0.25;       // metres between a controller and a panel it carries
const MAX_HOLD = 3;

// Wrist (guess, needs tuning on a headset): a smaller copy above the back of
// the left hand, tilted towards the eyes.
const WRIST_SCALE = 0.3;                             // ~35 x 20 cm
const WRIST_OFFSET = { x: 0, y: 0.15, z: 0.02 };     // from the controller to the middle of the plate
const WRIST_TILT = -40;                              // degrees, top tilted away from you

function loadMode() {
    try {
        const saved = window.localStorage.getItem(STORE_KEY);
        return MODES.indexOf(saved) !== -1 ? saved : 'follow';
    } catch (e) {
        return 'follow';
    }
}

// Where the middle of the panel goes for a head at h = {x, y, z, yaw}.
// Exported for the tests.
export function panelSpot(h) {
    return {
        x: h.x - Math.sin(h.yaw) * FORWARD,
        y: Math.max(LOWEST, h.y - DROP),
        z: h.z - Math.cos(h.yaw) * FORWARD,
        yaw: h.yaw
    };
}

function angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// options:
//   scene, panel, camera      the scene, the panel entity and the camera entity
//   busy()                    true while a controller is holding a whiteboard
//   status(text)              show a short message in the scene
export function createToolPanel(options) {
    const { scene, panel, camera } = options;
    const obj = panel.object3D;
    obj.rotation.order = 'YXZ';   // turn (yaw) first, then lean back (tilt)
    const tiltRad = -TILT * Math.PI / 180;
    const controllers = Array.from(document.querySelectorAll('.controller'));
    let mode = loadMode();
    const listeners = [];

    let target = null;        // { x, y, z, yaw } the panel glides to
    let awayFor = 0;          // seconds you've been looking away
    const triggers = new Set(); // controllers with the trigger held
    let carried = null;       // { controller, localPos } while a grip carries the panel

    function hand(controller) {
        const lc = controller.getAttribute('laser-controls');
        return (lc && lc.hand) || '';
    }
    const leftHand = controllers.find((c) => hand(c) === 'left') || null;

    // ---- Where the head is and which way it looks (level) ----

    const tmpV = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    function head() {
        camera.object3D.updateWorldMatrix(true, false);
        const p = new THREE.Vector3().setFromMatrixPosition(camera.object3D.matrixWorld);
        camera.object3D.getWorldQuaternion(tmpQ);
        const f = tmpV.set(0, 0, -1).applyQuaternion(tmpQ);
        // Looking straight up or down: keep the old direction.
        const yaw = (f.x * f.x + f.z * f.z) < 1e-4 ? obj.rotation.y : Math.atan2(-f.x, -f.z);
        return { x: p.x, y: p.y, z: p.z, yaw: yaw };
    }

    const spotInFront = panelSpot;

    // Full size, upright and leaning back, keeping its turn.
    function resetScale() {
        obj.scale.set(1, 1, 1);
        obj.rotation.set(tiltRad, obj.rotation.y, 0, 'YXZ');
    }

    // Outside a headset: a little further away than in VR, so the desktop
    // view shows the board above it.
    function putAtStart() {
        target = null;
        const spot = spotInFront(DESKTOP_HEAD);
        spot.z -= DESKTOP_EXTRA;
        spot.y = DESKTOP_HEAD.y - DESKTOP_DROP;
        jumpTo(spot);
    }

    function jumpTo(spot) {
        resetScale();
        target = null;
        obj.position.set(spot.x, spot.y, spot.z);
        obj.rotation.y = spot.yaw;
    }

    // Bring the panel in front of the user now (glides there).
    function bringHere() {
        if (!scene.is('vr-mode') || mode === 'wrist') return false;
        resetScale();
        target = spotInFront(head());
        awayFor = 0;
        return true;
    }

    function inUse() {
        return !!carried || triggers.size > 0 || pointingAtPanel() || (options.busy && options.busy());
    }

    // ---- Carrying it with the grip (bug V6) ----

    // Is the first thing this controller points at part of the panel?
    function pointsAtPanel(controller) {
        const rc = controller.components.raycaster;
        if (!rc || !rc.intersections) return false;
        const first = rc.intersections.find((i) => i.object && i.object.el && i.object.el !== controller);
        return !!first && onPanel(first.object.el);
    }

    function carry(controller) {
        if (carried || !scene.is('vr-mode') || !pointsAtPanel(controller)) return false;
        if (mode === 'wrist') {
            // Off the wrist: full size where it is, then carry it.
            obj.updateMatrixWorld();
            const p = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
            resetScale();
            obj.position.copy(p);
        }
        target = null;
        controller.object3D.updateMatrixWorld();
        const inv = new THREE.Matrix4();
        if (inv.invert) inv.copy(controller.object3D.matrixWorld).invert(); // newer three.js
        else inv.getInverse(controller.object3D.matrixWorld);
        carried = { controller: controller, localPos: obj.position.clone().applyMatrix4(inv) };
        options.status('Moving the tool panel. Let go of the grip to leave it there.');
        return true;
    }

    function drop(controller) {
        if (!carried || carried.controller !== controller) return;
        carried = null;
        if (mode !== 'stay') setMode('stay', true);
        options.status('Tool panel left here (Panel: Stay). Press Panel for Follow, or B / Y to bring it back.');
    }

    function followGrip() {
        const ctrl = carried.controller.object3D;
        ctrl.updateMatrixWorld();
        const origin = new THREE.Vector3().setFromMatrixPosition(ctrl.matrixWorld);
        const p = carried.localPos.clone().applyMatrix4(ctrl.matrixWorld);
        // Keep it between MIN_HOLD and MAX_HOLD from the hand.
        const d = p.distanceTo(origin);
        if (d < MIN_HOLD || d > MAX_HOLD) p.sub(origin).setLength(Math.min(MAX_HOLD, Math.max(MIN_HOLD, d))).add(origin);
        p.y = Math.max(0.2, p.y);
        obj.position.copy(p);
        // Face the head, upright and leaning back.
        const h = head();
        obj.rotation.set(tiltRad, Math.atan2(h.x - p.x, h.z - p.z), 0, 'YXZ');
    }

    // ---- Wrist ----

    const wristLocal = new THREE.Matrix4();
    (function () {
        const t = new THREE.Matrix4().makeTranslation(WRIST_OFFSET.x, WRIST_OFFSET.y, WRIST_OFFSET.z);
        const r = new THREE.Matrix4().makeRotationX(WRIST_TILT * Math.PI / 180);
        const s = new THREE.Matrix4().makeScale(WRIST_SCALE, WRIST_SCALE, WRIST_SCALE);
        wristLocal.multiply(t).multiply(r).multiply(s);
    })();
    const wristWorld = new THREE.Matrix4();

    function leftTracked() {
        if (!leftHand) return false;
        const tc = leftHand.components['tracked-controls'];
        return !!(tc && tc.controller) && leftHand.object3D.visible !== false;
    }

    function followWrist() {
        if (!leftTracked()) return;
        leftHand.object3D.updateWorldMatrix(true, false);
        wristWorld.multiplyMatrices(leftHand.object3D.matrixWorld, wristLocal);
        // The panel sits in the scene root, so its matrix is its world matrix.
        wristWorld.decompose(obj.position, obj.quaternion, obj.scale);
    }

    // ---- Every frame ----

    function update(dt) {
        if (!scene.is('vr-mode')) return;

        if (carried) {
            followGrip();
            return;
        }

        if (mode === 'wrist') {
            followWrist();
            return;
        }

        if (mode === 'follow' && !target && !inUse()) {
            const h = head();
            const away = Math.abs(angleDiff(h.yaw, obj.rotation.y)) > TURN_AWAY * Math.PI / 180;
            const spot = spotInFront(h);
            const far = Math.hypot(spot.x - obj.position.x, spot.z - obj.position.z) > MOVE_AWAY;
            awayFor = away ? awayFor + dt : 0;
            if (far || awayFor > TURN_WAIT) {
                target = spot;
                awayFor = 0;
            }
        }

        if (target) {
            const k = 1 - Math.exp(-dt * 3 / GLIDE);  // ~95% of the way in GLIDE seconds
            obj.position.x += (target.x - obj.position.x) * k;
            obj.position.y += (target.y - obj.position.y) * k;
            obj.position.z += (target.z - obj.position.z) * k;
            obj.rotation.set(tiltRad, obj.rotation.y + angleDiff(target.yaw, obj.rotation.y) * k, 0, 'YXZ');
            const left = Math.hypot(target.x - obj.position.x, target.y - obj.position.y, target.z - obj.position.z);
            if (left < 0.005 && Math.abs(angleDiff(target.yaw, obj.rotation.y)) < 0.005) {
                jumpTo(target);
            }
        }
    }

    if (!AFRAME.components['tool-panel-tick']) {
        AFRAME.registerComponent('tool-panel-tick', {
            tick: function (time, delta) {
                if (this.el.toolPanelUpdate) this.el.toolPanelUpdate(Math.min(delta || 16, 100) / 1000);
            }
        });
    }
    panel.toolPanelUpdate = update;
    panel.setAttribute('tool-panel-tick', '');

    // ---- Controllers ----

    function onPanel(el) {
        while (el) {
            if (el === panel) return true;
            el = el.parentNode && el.parentNode.isEntity ? el.parentNode : null;
        }
        return false;
    }

    // A controller is aiming at a panel control (not just the backing
    // plate, which a resting controller points at most of the time and
    // which kept the panel from ever following your turns: bug 32).
    function pointingAtPanel() {
        return controllers.some((controller) => {
            const rc = controller.components.raycaster;
            if (!rc || !rc.intersections) return false;
            const first = rc.intersections.find((i) => i.object && i.object.el && i.object.el !== controller &&
                !i.object.el.classList.contains('panel-backing'));
            return !!first && first.object.el.id !== 'vr-panel-handle' && onPanel(first.object.el);
        });
    }

    controllers.forEach((controller) => {
        controller.addEventListener('triggerdown', () => triggers.add(controller));
        controller.addEventListener('triggerup', () => triggers.delete(controller));
        controller.addEventListener('gripdown', () => carry(controller));
        controller.addEventListener('gripup', () => drop(controller));
        ['bbuttondown', 'ybuttondown', 'menudown'].forEach((name) => {
            controller.addEventListener(name, () => {
                if (bringHere()) options.status('Tool panel brought in front of you.');
            });
        });
    });

    scene.addEventListener('enter-vr', () => {
        // Wait a moment for the headset's own head position to arrive.
        setTimeout(() => {
            // Follow and Stay both start in front of you, at your real height.
            if (mode !== 'wrist' && scene.is('vr-mode')) jumpTo(spotInFront(head()));
        }, 300);
    });
    scene.addEventListener('exit-vr', () => {
        triggers.clear();
        carried = null;
        putAtStart();
    });

    // ---- Settings ----

    // quiet: don't show the usual message (dropping the panel shows its own).
    function setMode(next, quiet) {
        const before = mode;
        mode = MODES.indexOf(next) !== -1 ? next : 'follow';
        try { window.localStorage.setItem(STORE_KEY, mode); } catch (e) { /* private mode */ }
        target = null;
        awayFor = 0;
        if (mode !== 'wrist' && !carried) {
            if (obj.scale.x !== 1 || before === 'wrist') {
                // Coming off the wrist: full size, in front of you.
                if (scene.is('vr-mode')) jumpTo(spotInFront(head()));
                else putAtStart();
            } else if (mode === 'follow' && scene.is('vr-mode')) {
                // Back to Follow: glide in front of you now (bug V3).
                bringHere();
            }
        }
        listeners.forEach((fn) => fn(mode));
        if (quiet) return;
        if (mode === 'follow') {
            options.status('Panel follows you: it moves in front of you when you turn away or move. B or Y brings it now.');
        } else if (mode === 'wrist') {
            options.status(leftTracked() || !scene.is('vr-mode')
                ? 'Panel on your left hand: point at it with the right controller.'
                : 'Panel on your left hand: it appears there once the left controller is seen.');
        } else {
            options.status('Panel stays here. B or Y brings it in front of you.');
        }
    }

    function nextMode() {
        setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    }

    // "Back to start": the panel goes back too, unless it's on the wrist.
    function backToStart() {
        if (mode === 'wrist') return;
        if (scene.is('vr-mode')) {
            // The rig has just been reset; put the panel in front of the head there.
            setTimeout(() => jumpTo(spotInFront(head())), 0);
        } else {
            putAtStart();
        }
    }

    putAtStart();

    return {
        mode: () => mode,
        setMode: setMode,
        nextMode: nextMode,
        onModeChange: (fn) => listeners.push(fn),
        bringHere: bringHere,
        // True while this controller's grip carries the panel, or would pick
        // it up (it points at the panel), so the grip doesn't also grab a board.
        holds: (controller) => !!carried && carried.controller === controller,
        wantsGrip: (controller) => (!!carried && carried.controller === controller) || pointsAtPanel(controller),
        backToStart: backToStart,
        // After a jump (e.g. into a 360-degree board): put the panel in front
        // of the user straight away, unless it's on the wrist or set to Stay.
        jumpHere: () => {
            if (mode !== 'follow' || !scene.is('vr-mode')) return;
            setTimeout(() => jumpTo(spotInFront(head())), 0);
        },
        // For tests.
        update: update
    };
}

export function describePanelMode(mode) {
    return mode === 'wrist' ? 'Wrist' : mode === 'stay' ? 'Stay' : 'Follow';
}
