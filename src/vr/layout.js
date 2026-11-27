// Where each whiteboard goes in the VR room.
//
// Boards can have different sizes (1000 canvas pixels = 1 metre), so the
// layout looks at every board's size:
//
// - The first board stays where the original single board was: in front of
//   the user, behind the tool tray and button columns. A board wider than
//   the tray moves back a little so the buttons stay in front of it, and a
//   tall board grows upwards so it doesn't go below the tray.
// - Extra boards go on a ring around the user, taking turns on the left and
//   the right, each one placed next to the last on that side. How much of
//   the ring a board takes depends on its width. When a board doesn't fit,
//   a new ring starts further out (turned a little so boards don't hide
//   each other).
//
// A board with a stored `pose` ({position: [x, y, z], rotationY} in degrees,
// world coordinates) is put exactly there instead. A board gets a pose when
// someone moves it (see board-mover.js); "Auto place" sets it back to null.
// Boards that were moved don't take part in the ring, so a moved board can
// overlap an automatically placed one.
//
// 360-degree boards (shape "cylinder") are rooms of their own: a round wall
// you stand inside. They don't take part in the ring. Each one gets its own
// spot behind where you start, beyond the ring boards, one after another
// further back; "Go inside" takes you to its middle. Their pose is the
// middle of the cylinder, and rotationY turns the wall (the middle of the
// canvas faces the cylinder's local -z, i.e. towards the start at rotation 0).

import { PX_PER_METRE, DEFAULT_WIDTH, DEFAULT_HEIGHT, isWrapBoard } from '../board-client';

export const CENTER = { x: 0, z: 0.1 };   // where the user stands
export const BOARD_HEIGHT = 1.4;          // centre of a standard board above the floor

const FIRST_Z = -0.6;                     // the original board's distance
const FIRST_Z_WIDE = -0.7;                // behind the buttons, for boards wider than the tray
const TRAY_WIDTH = 1.7;
const FIRST_BOTTOM = 0.9;                 // lowest edge of the first board (just above the tray)
const RING_BOTTOM = 0.4;                  // lowest edge of boards on the ring
const RING_RADIUS = 1.7;
const RING_STEP = 1.3;
const RING_GAP = 1;                       // degrees between neighbouring frames
const MIN_FRONT = 45;                     // degrees kept clear on each side of straight ahead
const FRAME = 0.06;                       // the frame adds this much to a board's width
const WRAP_BOTTOM = 0.35;                 // lowest edge of a 360-degree board's wall
const WRAP_FIRST = 6;                     // metres behind the start to the first 360-degree board's middle
const WRAP_GAP = 1.5;                     // metres between neighbouring 360-degree boards (and the ring)

// Size of a board in metres.
export function boardMetres(width, height) {
    return {
        w: (width || DEFAULT_WIDTH) / PX_PER_METRE,
        h: (height || DEFAULT_HEIGHT) / PX_PER_METRE
    };
}

function deg(rad) { return rad * 180 / Math.PI; }

function centreY(h, bottom) {
    return Math.max(BOARD_HEIGHT, bottom + h / 2);
}

function ringPose(angle, radius, h) {
    const rad = angle * Math.PI / 180;
    return {
        position: [CENTER.x - Math.sin(rad) * radius, centreY(h, RING_BOTTOM), CENTER.z - Math.cos(rad) * radius],
        rotationY: angle
    };
}

function hasPose(pose) {
    return pose && Array.isArray(pose.position) && pose.position.length === 3 && pose.position.every((n) => typeof n === 'number' && isFinite(n));
}

// Radius of a 360-degree board's wall in metres.
export function wrapRadius(width) {
    return (width || 8000) / PX_PER_METRE / (2 * Math.PI);
}

// boards: [{ width, height, pose, shape }] in creation order (the first flat
// board is the front board). Returns one { position: [x, y, z], rotationY }
// per board, in the same order.
export function layoutBoards(boards) {
    const flatIndex = [];
    const wrapIndex = [];
    boards.forEach((b, i) => (isWrapBoard(b) ? wrapIndex : flatIndex).push(i));
    const result = new Array(boards.length);
    const flat = layoutFlat(flatIndex.map((i) => boards[i]));
    flatIndex.forEach((i, k) => { result[i] = flat.poses[k]; });

    // 360-degree boards: in a row straight behind the start, clear of the ring.
    let distance = Math.max(WRAP_FIRST, flat.outerRadius + WRAP_GAP);
    let first = true;
    wrapIndex.forEach((i) => {
        const b = boards[i];
        if (hasPose(b.pose)) {
            result[i] = { position: b.pose.position.slice(), rotationY: Number(b.pose.rotationY) || 0 };
            return;
        }
        const r = wrapRadius(b.width);
        const h = (b.height || 1800) / PX_PER_METRE;
        distance += first ? 0 : r;
        first = false;
        result[i] = { position: [CENTER.x, WRAP_BOTTOM + h / 2, CENTER.z + distance], rotationY: 0 };
        distance += r + WRAP_GAP + r;
    });
    return result;
}

// Is the point (x, z) inside the 360-degree board placed at `pose`?
export function insideWrap(pose, width, x, z) {
    if (!pose) return false;
    return Math.hypot(x - pose.position[0], z - pose.position[2]) < wrapRadius(width) - 0.05;
}

// The flat boards. Returns { poses, outerRadius } where outerRadius is how
// far from the start the outermost ring reaches (0 with no ring boards).
function layoutFlat(boards) {
    const result = [];
    let outerRadius = 0;
    if (!boards.length) return { poses: result, outerRadius: outerRadius };

    // First board.
    const first = boardMetres(boards[0].width, boards[0].height);
    const firstZ = first.w > TRAY_WIDTH - 0.1 ? FIRST_Z_WIDE : FIRST_Z;
    result.push(hasPose(boards[0].pose)
        ? { position: boards[0].pose.position.slice(), rotationY: Number(boards[0].pose.rotationY) || 0 }
        : { position: [0, centreY(first.h, FIRST_BOTTOM), firstZ], rotationY: 0 });

    // The front sector the first board covers, seen from where the user stands.
    const front = Math.max(MIN_FRONT, deg(Math.atan2((first.w + FRAME) / 2, CENTER.z - firstZ)) + RING_GAP);

    // Angles go 0..360 counter-clockwise from straight ahead (90 = left).
    // The left side fills upwards from `front`, the right side downwards
    // from 360 - front; they meet behind the user.
    let ring = 0;
    let radius = RING_RADIUS;
    let left = front;
    let right = 360 - front;
    let turnLeft = true;

    const newRing = () => {
        ring += 1;
        radius = RING_RADIUS + RING_STEP * ring;
        const shift = ring % 2 ? 26 : 0; // so boards on the next ring aren't hidden
        left = front + shift;
        right = 360 - front + shift;
        turnLeft = true;
    };

    for (let i = 1; i < boards.length; i++) {
        const size = boardMetres(boards[i].width, boards[i].height);
        if (hasPose(boards[i].pose)) {
            result.push({ position: boards[i].pose.position.slice(), rotationY: Number(boards[i].pose.rotationY) || 0 });
            continue;
        }
        let pose = null;
        for (let tries = 0; !pose && tries < 20; tries++) {
            const span = 2 * deg(Math.atan2((size.w + FRAME) / 2, radius)); // angle the board covers
            const room = right - left;
            if (room >= 2 * (span + RING_GAP) + RING_GAP) {
                if (turnLeft) {
                    pose = ringPose(left + RING_GAP + span / 2, radius, size.h);
                    left += span + RING_GAP;
                } else {
                    pose = ringPose(right - RING_GAP - span / 2, radius, size.h);
                    right -= span + RING_GAP;
                }
                turnLeft = !turnLeft;
            } else if (room >= span + 2 * RING_GAP) {
                // The last spot on this ring: centre it in the gap behind the user.
                pose = ringPose((left + right) / 2, radius, size.h);
                left = right;
            } else {
                newRing();
            }
        }
        result.push(pose || ringPose(180, radius, size.h));
        outerRadius = Math.max(outerRadius, radius);
    }
    return { poses: result, outerRadius: outerRadius };
}

// A few words saying where a board is, for messages like "added to your left".
export function describePose(p) {
    let a = ((p.rotationY % 360) + 360) % 360; // 0 = in front, 90 = left
    if (a > 180) a -= 360;
    if (Math.abs(a) < 30) return 'in front of you';
    if (Math.abs(a) > 150) return 'behind you';
    if (a > 0) return Math.abs(a) > 100 ? 'behind you on your left' : 'on your left';
    return Math.abs(a) > 100 ? 'behind you on your right' : 'on your right';
}

// ---- Moving boards by hand (see board-mover.js) ----

// Kept in step with cleanPose in lib/board-store.js.
export const POSE_MAX_DISTANCE = 30;
export const POSE_MAX_HEIGHT = 10;
const FLOOR_GAP = 0.02;                    // a board's lowest edge stays this far above the floor
export const NUDGE_STEP = 0.25;            // metres per press of a desktop move button
export const TURN_STEP = 15;               // degrees per press of a desktop turn button

function wrapDegrees(a) {
    a = ((a % 360) + 360) % 360;
    return a >= 360 ? 0 : a;
}

// Keep a pose inside the room: upright, above the floor, not too high or far.
// `size` is the board's size in metres ({w, h}); the board's bottom edge
// stays above the floor.
export function clampPose(pose, size) {
    let [x, y, z] = pose.position;
    const dist = Math.hypot(x, z);
    if (dist > POSE_MAX_DISTANCE) {
        x *= POSE_MAX_DISTANCE / dist;
        z *= POSE_MAX_DISTANCE / dist;
    }
    const half = size ? size.h / 2 : 0;
    y = Math.min(POSE_MAX_HEIGHT, Math.max(half + FLOOR_GAP, y));
    const mm = (n) => Math.round(n * 1000) / 1000;
    return { position: [mm(x), mm(y), mm(z)], rotationY: Math.round(wrapDegrees(pose.rotationY || 0) * 10) / 10 };
}

// The rotation that turns a board at `position` to face where the user stands.
export function facingRotation(position) {
    const dx = CENTER.x - position[0];
    const dz = CENTER.z - position[2];
    if (Math.hypot(dx, dz) < 1e-6) return 0;
    return wrapDegrees(Math.atan2(dx, dz) * 180 / Math.PI);
}

// One press of a desktop move button. Directions are as seen by someone
// standing in front of the board: left/right slide it along its own width,
// closer/farther move it towards/away from where the user stands, up/down
// change its height, turn-left/turn-right spin it on the spot, and face
// turns it to face the user.
export function nudgePose(pose, action, size) {
    const p = { position: pose.position.slice(), rotationY: pose.rotationY || 0 };
    const rad = p.rotationY * Math.PI / 180;
    // The board's own right-hand direction (its local +x) in world space.
    const right = [Math.cos(rad), -Math.sin(rad)];
    switch (action) {
        case 'left':
        case 'right': {
            const s = action === 'right' ? NUDGE_STEP : -NUDGE_STEP;
            p.position[0] += right[0] * s;
            p.position[2] += right[1] * s;
            break;
        }
        case 'up': p.position[1] += NUDGE_STEP; break;
        case 'down': p.position[1] -= NUDGE_STEP; break;
        case 'closer':
        case 'farther': {
            let dx = p.position[0] - CENTER.x;
            let dz = p.position[2] - CENTER.z;
            let d = Math.hypot(dx, dz);
            if (d < 1e-6) { dx = -Math.sin(rad); dz = -Math.cos(rad); d = 1; }
            const target = Math.max(0.3, d + (action === 'farther' ? NUDGE_STEP : -NUDGE_STEP));
            p.position[0] = CENTER.x + dx / d * target;
            p.position[2] = CENTER.z + dz / d * target;
            break;
        }
        case 'turn-left': p.rotationY += TURN_STEP; break;
        case 'turn-right': p.rotationY -= TURN_STEP; break;
        case 'face': p.rotationY = facingRotation(p.position); break;
        default: break;
    }
    return clampPose(p, size);
}
