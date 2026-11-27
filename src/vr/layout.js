// Where each whiteboard goes in the VR room.
//
// The first board stays where the original single board was: in front of
// the user, inside the tool tray and button columns. Extra boards go on a
// ring around the user (left, right, then further behind), so they don't
// collide with the tray or with each other. When a ring is full the next
// ring is further out and turned a little so boards don't hide each other.
//
// A board with a stored `pose` ({position: [x, y, z], rotationY} in degrees,
// world coordinates) is put exactly there instead. Nothing sets a pose yet;
// that is for the later "reposition whiteboards" feature. This function is
// also the place to change for the 360-degree board.

export const CENTER = { x: 0, z: 0.1 };   // where the user stands
export const BOARD_HEIGHT = 1.4;          // centre of a board above the floor
export const BOARD_WIDTH = 1.5;           // metres (board is 1.5 x 1)

const FIRST_POSITION = [0, BOARD_HEIGHT, -0.6];
const RING_ANGLES = [75, -75, 130, -130, 180]; // degrees, + is to the left
const RING_RADIUS = 1.6;
const RING_STEP = 1.3;
const PER_RING = RING_ANGLES.length;

// index: place of the board in creation order (0 = first board).
export function boardPose(index, pose) {
    if (pose && Array.isArray(pose.position) && pose.position.length === 3) {
        return { position: pose.position.slice(), rotationY: Number(pose.rotationY) || 0 };
    }
    if (index <= 0) return { position: FIRST_POSITION.slice(), rotationY: 0 };
    const k = index - 1;
    const ring = Math.floor(k / PER_RING);
    const angle = RING_ANGLES[k % PER_RING] + (ring % 2 ? 26 : 0);
    const radius = RING_RADIUS + RING_STEP * ring;
    const rad = angle * Math.PI / 180;
    return {
        position: [CENTER.x - Math.sin(rad) * radius, BOARD_HEIGHT, CENTER.z - Math.cos(rad) * radius],
        rotationY: angle
    };
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
