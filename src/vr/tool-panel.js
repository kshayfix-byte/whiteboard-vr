// Where the VR tool panel (colours, sizes, eraser, Save, board buttons, ...)
// sits while you move around.
//
// Three ways, switched with the "Panel" button at the top of the panel (the
// choice is remembered on this device):
//
// - Follow (default): the panel floats in front of you, the same distance
//   and height as the original panel at the start spot. It stays still while
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
// The panel is an entity in the room (not inside the rig), so "Stay" is
// simply "don't move it". Its children keep the positions from vr.html, which
// were laid out for a user standing at the start spot.
//
// Outside VR the panel always goes back to the start spot, where the
// original desktop view expects it.

const MODES = ['follow', 'wrist', 'stay'];
const STORE_KEY = 'whiteboard-vr-panel';

const TURN_AWAY = 65;        // degrees between where you look and the panel before it follows
const TURN_WAIT = 0.6;       // ...for this many seconds
const MOVE_AWAY = 1.0;       // metres you can move away before it follows
const GLIDE = 0.25;          // seconds, roughly, for it to glide into place
const START = { x: 0, y: 0.3, z: 0 };     // the original panel spot
const HEAD_START = { y: 1.6, z: 0.1 };    // the head the original panel was laid out for (standing)
const HEIGHT_MIN = -0.3;     // how far the panel may go down/up from the original height
const HEIGHT_MAX = 0.6;      // for people sitting or very tall people

// Wrist (guess, needs tuning on a headset): a smaller copy above the back of
// the left hand, tilted towards the eyes.
const WRIST_SCALE = 0.18;                            // ~37 x 30 cm
const WRIST_CENTRE = { x: 0, y: 1.0, z: -0.57 };     // middle of the panel's contents (vr.html)
const WRIST_OFFSET = { x: 0, y: 0.17, z: 0.02 };     // from the controller
const WRIST_TILT = -40;                              // degrees, top tilted away from you

function loadMode() {
    try {
        const saved = window.localStorage.getItem(STORE_KEY);
        return MODES.indexOf(saved) !== -1 ? saved : 'follow';
    } catch (e) {
        return 'follow';
    }
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
    const controllers = Array.from(document.querySelectorAll('.controller'));
    let mode = loadMode();
    const listeners = [];

    let target = null;        // { x, y, z, yaw } the panel glides to
    let awayFor = 0;          // seconds you've been looking away
    const triggers = new Set(); // controllers with the trigger held

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

    // The spot in front of the head where the original panel would be if the
    // start spot had been here.
    function spotInFront(h) {
        const back = HEAD_START.z - START.z;   // the panel's origin is this far in front of the head
        const y = Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, h.y - HEAD_START.y)) + START.y;
        return {
            x: h.x - Math.sin(h.yaw) * back,
            y: y,
            z: h.z - Math.cos(h.yaw) * back,
            yaw: h.yaw
        };
    }

    function resetScale() {
        obj.scale.set(1, 1, 1);
        obj.rotation.set(0, obj.rotation.y, 0);
    }

    function putAtStart() {
        target = null;
        resetScale();
        obj.position.set(START.x, START.y, START.z);
        obj.rotation.set(0, 0, 0);
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
        return triggers.size > 0 || pointingAtPanel() || (options.busy && options.busy());
    }

    // ---- Wrist ----

    const wristLocal = new THREE.Matrix4();
    (function () {
        const t = new THREE.Matrix4().makeTranslation(WRIST_OFFSET.x, WRIST_OFFSET.y, WRIST_OFFSET.z);
        const r = new THREE.Matrix4().makeRotationX(WRIST_TILT * Math.PI / 180);
        const s = new THREE.Matrix4().makeScale(WRIST_SCALE, WRIST_SCALE, WRIST_SCALE);
        const c = new THREE.Matrix4().makeTranslation(-WRIST_CENTRE.x, -WRIST_CENTRE.y, -WRIST_CENTRE.z);
        wristLocal.multiply(t).multiply(r).multiply(s).multiply(c);
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
            obj.rotation.y += angleDiff(target.yaw, obj.rotation.y) * k;
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

    function pointingAtPanel() {
        return controllers.some((controller) => {
            const rc = controller.components.raycaster;
            return !!(rc && rc.intersectedEls && rc.intersectedEls.some(onPanel));
        });
    }

    controllers.forEach((controller) => {
        controller.addEventListener('triggerdown', () => triggers.add(controller));
        controller.addEventListener('triggerup', () => triggers.delete(controller));
        ['bbuttondown', 'ybuttondown', 'menudown'].forEach((name) => {
            controller.addEventListener(name, () => {
                if (bringHere()) options.status('Tool panel brought in front of you.');
            });
        });
    });

    scene.addEventListener('enter-vr', () => {
        // Wait a moment for the headset's own head position to arrive.
        setTimeout(() => {
            if (mode === 'follow' && scene.is('vr-mode')) jumpTo(spotInFront(head()));
        }, 300);
    });
    scene.addEventListener('exit-vr', () => {
        triggers.clear();
        putAtStart();
    });

    // ---- Settings ----

    function setMode(next) {
        mode = MODES.indexOf(next) !== -1 ? next : 'follow';
        try { window.localStorage.setItem(STORE_KEY, mode); } catch (e) { /* private mode */ }
        target = null;
        awayFor = 0;
        if (mode !== 'wrist') {
            // Coming off the wrist: full size, in front of you.
            if (obj.scale.x !== 1) {
                if (scene.is('vr-mode')) jumpTo(spotInFront(head()));
                else putAtStart();
            }
        }
        listeners.forEach((fn) => fn(mode));
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
        backToStart: backToStart,
        // For tests.
        update: update
    };
}

export function describePanelMode(mode) {
    return mode === 'wrist' ? 'Wrist' : mode === 'stay' ? 'Stay' : 'Follow';
}
