// Moving yourself around the VR room with the controller thumbsticks.
//
// Two ways to move, switched with the "Moving" button on the tool panel
// (the choice is remembered on this device):
//
// - Teleport (default, the most comfortable for most people): push either
//   thumbstick forward and an arc comes out of that controller, with a ring
//   where you'll land. Aim it, then let the stick go to jump there. A red arc
//   means you can't land there (too far, or off the edge of the room).
// - Smooth: the left thumbstick walks you around, in the direction you're
//   looking (left/right steps sideways).
//
// In both, pushing a thumbstick left or right turns you 30 degrees in one go
// ("snap turn"): the right stick in smooth mode, either stick in teleport mode.
//
// While a controller's grip is holding a whiteboard, its thumbstick belongs
// to the board (push/pull/turn it, see board-mover.js) and doesn't move you.
//
// "Back to start" puts you back where you started.
//
// Everything moves a "rig" entity that holds the camera and both
// controllers, so where you stand in your real room still counts on top.

const SPEED = 2;            // smooth walking, metres per second (guess: a brisk walk)
const SNAP_ANGLE = 30;      // degrees per snap turn
const AREA_RADIUS = 25;     // you can't go further than this from the start
const ARC_SPEED = 8;        // teleport arc launch speed, m/s: reaches about 7 m
const GRAVITY = 9.8;
const ARC_STEP = 0.025;     // seconds between arc points
const ARC_POINTS = 80;
const PUSH = 0.6;           // stick deflection that counts as a push
const RELEASE = 0.3;        // ...and as let go
const DEADZONE = 0.2;

const STORE_KEY = 'whiteboard-vr-moving';
const VALID_COLOR = 0x3BA3FF;
const INVALID_COLOR = 0xC0392B;

function loadMode() {
    try {
        return window.localStorage.getItem(STORE_KEY) === 'smooth' ? 'smooth' : 'teleport';
    } catch (e) {
        return 'teleport';
    }
}

// options:
//   scene, rig, camera       the scene, rig and camera entities
//   busy(controller)         true while that controller is holding a board
//   status(text)             show a short message in the scene
export function createLocomotion(options) {
    const { scene, rig, camera } = options;
    let mode = loadMode();
    const modeListeners = [];
    const controllers = Array.from(document.querySelectorAll('.controller'));
    const sticks = new Map();     // controller -> { x, y, turned, aiming }

    function hand(controller) {
        const lc = controller.getAttribute('laser-controls');
        return (lc && lc.hand) || '';
    }

    function stick(controller) {
        if (!sticks.has(controller)) sticks.set(controller, { x: 0, y: 0, turned: false, aiming: false });
        return sticks.get(controller);
    }

    // ---- Where the user's head is ----

    const tmp = new THREE.Vector3();
    function headWorld() {
        camera.object3D.updateWorldMatrix(true, false); // the rig may have just moved
        return new THREE.Vector3().setFromMatrixPosition(camera.object3D.matrixWorld);
    }

    // Move the rig so the head ends up over (x, z), kept inside the area.
    function putHeadAt(x, z) {
        const len = Math.hypot(x, z);
        if (len > AREA_RADIUS) { x *= AREA_RADIUS / len; z *= AREA_RADIUS / len; }
        const head = headWorld();
        rig.object3D.position.x += x - head.x;
        rig.object3D.position.z += z - head.z;
    }

    // ---- Snap turn: turn the rig around the head ----

    function snapTurn(direction) {
        const angle = -direction * SNAP_ANGLE * Math.PI / 180; // stick right = turn right
        const head = headWorld();
        const p = rig.object3D.position;
        const dx = p.x - head.x;
        const dz = p.z - head.z;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        p.x = head.x + dx * cos + dz * sin;
        p.z = head.z - dx * sin + dz * cos;
        rig.object3D.rotation.y += angle;
    }

    // Turn the rig around the head so the head faces world yaw `yaw` (degrees,
    // 0 = looking along -z, 90 = looking along -x).
    function faceYaw(yaw) {
        camera.object3D.updateWorldMatrix(true, false);
        const q = new THREE.Quaternion();
        camera.object3D.getWorldQuaternion(q);
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
        const now = Math.atan2(-f.x, -f.z);
        const angle = yaw * Math.PI / 180 - now;
        const head = headWorld();
        const p = rig.object3D.position;
        const dx = p.x - head.x;
        const dz = p.z - head.z;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        p.x = head.x + dx * cos + dz * sin;
        p.z = head.z - dx * sin + dz * cos;
        rig.object3D.rotation.y += angle;
    }

    // ---- Teleport arc ----

    const arcPositions = new Float32Array(ARC_POINTS * 3);
    const arcGeometry = new THREE.BufferGeometry();
    arcGeometry.setAttribute
        ? arcGeometry.setAttribute('position', new THREE.BufferAttribute(arcPositions, 3))
        : arcGeometry.addAttribute('position', new THREE.BufferAttribute(arcPositions, 3));
    const arcMaterial = new THREE.LineBasicMaterial({ color: VALID_COLOR });
    const arcLine = new THREE.Line(arcGeometry, arcMaterial);
    arcLine.frustumCulled = false;
    arcLine.visible = false;
    const landing = new THREE.Mesh(
        new THREE.RingBufferGeometry(0.18, 0.25, 32),
        new THREE.MeshBasicMaterial({ color: VALID_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    landing.rotation.x = -Math.PI / 2;
    landing.visible = false;
    scene.object3D.add(arcLine);
    scene.object3D.add(landing);

    let aim = null;   // { controller, target: Vector3 | null }

    // Work out the arc from the controller's pointer and draw it. Returns the
    // landing point on the floor, or null if it can't land.
    function traceArc(controller) {
        const rc = controller.components.raycaster;
        if (!rc || !rc.raycaster) return null;
        const ray = rc.raycaster.ray;                // world space, same as the laser
        const p0 = ray.origin;
        const v = ray.direction.clone().multiplyScalar(ARC_SPEED);
        let count = 0;
        let hit = null;
        for (let i = 0; i < ARC_POINTS; i++) {
            const t = i * ARC_STEP;
            const x = p0.x + v.x * t;
            const y = p0.y + v.y * t - 0.5 * GRAVITY * t * t;
            const z = p0.z + v.z * t;
            if (y <= 0 && i > 0) {
                // Finish exactly on the floor.
                const py = arcPositions[(i - 1) * 3 + 1];
                const f = py / (py - y);
                const px = arcPositions[(i - 1) * 3];
                const pz = arcPositions[(i - 1) * 3 + 2];
                hit = new THREE.Vector3(px + (x - px) * f, 0, pz + (z - pz) * f);
                arcPositions.set([hit.x, 0, hit.z], i * 3);
                count = i + 1;
                break;
            }
            arcPositions.set([x, y, z], i * 3);
            count = i + 1;
        }
        arcGeometry.setDrawRange(0, count);
        arcGeometry.attributes.position.needsUpdate = true;
        const ok = !!hit && Math.hypot(hit.x, hit.z) <= AREA_RADIUS;
        arcMaterial.color.setHex(ok ? VALID_COLOR : INVALID_COLOR);
        landing.material.color.setHex(ok ? VALID_COLOR : INVALID_COLOR);
        arcLine.visible = true;
        landing.visible = !!hit;
        if (hit) landing.position.set(hit.x, 0.01, hit.z);
        return ok ? hit : null;
    }

    function stopAiming(jump) {
        if (!aim) return;
        const target = aim.target;
        stick(aim.controller).aiming = false;
        aim = null;
        arcLine.visible = false;
        landing.visible = false;
        if (jump && target) putHeadAt(target.x, target.z);
    }

    // ---- Thumbsticks ----

    function onStick(controller, x, y) {
        const s = stick(controller);
        s.x = x;
        s.y = y;
        if (options.busy(controller)) {
            if (aim && aim.controller === controller) stopAiming(false);
            s.turned = true; // don't snap when the grip lets go with the stick still pushed
            return;
        }

        const canTurn = mode === 'teleport' || hand(controller) !== 'left';
        const canAim = mode === 'teleport';

        // Snap turn: one turn per push; let the stick go back to turn again.
        if (Math.abs(x) < RELEASE) s.turned = false;
        if (canTurn && !s.aiming && !s.turned && Math.abs(x) > PUSH && Math.abs(y) < PUSH) {
            s.turned = true;
            snapTurn(Math.sign(x));
        }

        // Teleport: push forward to aim, let go to jump.
        if (canAim) {
            if (!aim && y < -PUSH && Math.abs(x) < PUSH) {
                aim = { controller: controller, target: null };
                s.aiming = true;
            } else if (aim && aim.controller === controller && Math.hypot(x, y) < RELEASE) {
                stopAiming(true);
            }
        }
    }

    controllers.forEach((controller) => {
        controller.addEventListener('thumbstickmoved', (evt) => {
            onStick(controller, evt.detail.x || 0, evt.detail.y || 0);
        });
    });

    function update(dt) {
        if (!scene.is('vr-mode')) return;
        if (aim) {
            if (options.busy(aim.controller)) stopAiming(false);
            else aim.target = traceArc(aim.controller);
        }
        if (mode !== 'smooth') return;
        controllers.forEach((controller) => {
            if (hand(controller) !== 'left' || options.busy(controller)) return;
            const s = stick(controller);
            const x = Math.abs(s.x) > DEADZONE ? s.x : 0;
            const y = Math.abs(s.y) > DEADZONE ? s.y : 0;
            if (!x && !y) return;
            // Walk where the head is looking, kept level.
            const q = new THREE.Quaternion();
            camera.object3D.getWorldQuaternion(q);
            const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
            f.y = 0;
            if (f.lengthSq() < 1e-6) return;
            f.normalize();
            const right = tmp.set(-f.z, 0, f.x);
            const step = SPEED * dt;
            const head = headWorld();
            putHeadAt(head.x + (right.x * x - f.x * y) * step, head.z + (right.z * x - f.z * y) * step);
        });
    }

    if (!AFRAME.components['locomotion-tick']) {
        AFRAME.registerComponent('locomotion-tick', {
            tick: function (time, delta) {
                if (this.el.locomotionUpdate) this.el.locomotionUpdate(Math.min(delta || 16, 100) / 1000);
            }
        });
    }
    rig.locomotionUpdate = update;
    rig.setAttribute('locomotion-tick', '');
    scene.addEventListener('exit-vr', () => stopAiming(false));

    // ---- Settings ----

    function setMode(next) {
        mode = next === 'smooth' ? 'smooth' : 'teleport';
        try { window.localStorage.setItem(STORE_KEY, mode); } catch (e) { /* private mode */ }
        stopAiming(false);
        modeListeners.forEach((fn) => fn(mode));
        options.status(mode === 'smooth'
            ? 'Smooth moving: left thumbstick walks, right thumbstick turns.'
            : 'Teleport: push a thumbstick forward, aim, let go. Left/right turns.');
    }

    function backToStart() {
        stopAiming(false);
        rig.object3D.position.set(0, 0, 0);
        rig.object3D.rotation.set(0, 0, 0);
        if (!scene.is('vr-mode')) {
            // Desktop: the arrow/WASD keys move the camera itself.
            camera.setAttribute('position', '0 1.3 0.1');
            camera.object3D.rotation.set(0, 0, 0);
            const look = camera.components['look-controls'];
            if (look && look.yawObject) { look.yawObject.rotation.y = 0; look.pitchObject.rotation.x = 0; }
        }
    }

    return {
        mode: () => mode,
        setMode: setMode,
        toggleMode: () => setMode(mode === 'smooth' ? 'teleport' : 'smooth'),
        onModeChange: (fn) => modeListeners.push(fn),
        backToStart: backToStart,
        // For tests and the desktop page.
        snapTurn: snapTurn,
        teleportTo: (x, z) => putHeadAt(x, z),
        // Jump to (x, z) looking towards world yaw `yaw` (e.g. into a 360-degree board).
        goTo: (x, z, yaw) => {
            stopAiming(false);
            if (yaw != null) faceYaw(yaw);
            putHeadAt(x, z);
        },
        // Where the head is now, in world coordinates.
        headPosition: headWorld
    };
}
