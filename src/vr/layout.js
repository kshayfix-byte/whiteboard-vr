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
// world coordinates) is put exactly there instead. Nothing sets a pose yet;
// that is for the later "reposition whiteboards" feature. This file is also
// the place to change for the 360-degree board.

import { PX_PER_METRE, DEFAULT_WIDTH, DEFAULT_HEIGHT } from '../board-client';

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

// boards: [{ width, height, pose }] in creation order (first = front board).
// Returns one { position: [x, y, z], rotationY } per board.
export function layoutBoards(boards) {
    const result = [];
    if (!boards.length) return result;

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
    }
    return result;
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
