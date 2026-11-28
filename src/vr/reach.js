// How far the controllers reach, and which thing a controller is pointing at.
//
// Originally the marker only reached 20 cm, so you had to stand right at a
// board. "Long reach" stretches the pointer to LONG_REACH metres, so boards
// across the room can be drawn on. Close up it works exactly as before: the
// pointer simply hits the board nearer.
//
// With a long pointer, one ray can pass through several things (a button,
// then the board behind it, then another board further back). Only the
// nearest one counts; use nearestHit() before acting on a hit.
//
// The Reach setting only limits drawing (and erasing) on whiteboards. The
// pointer itself always reaches LONG_REACH, so the tool panel's buttons work
// the same with either setting (bug V9).
//
// Every panel control (colours, eraser, highlighter, Erase board, buttons)
// needs a trigger press while the pointer is on it. They used to fire when
// the pointer merely touched them from within 20 cm, which made them go off
// by themselves when the panel is on the wrist, right next to the other hand
// (bug V7).

export const NEAR_REACH = 0.2;   // metres; the original marker length
export const LONG_REACH = 12;    // metres

const STORE_KEY = 'whiteboard-vr-reach';

function load() {
    try {
        return window.localStorage.getItem(STORE_KEY) === 'short' ? 'short' : 'long';
    } catch (e) {
        return 'long';
    }
}

let mode = load();
const listeners = [];

export function reachMode() {
    return mode;
}

export function reachMetres() {
    return mode === 'short' ? NEAR_REACH : LONG_REACH;
}

export function setReachMode(next) {
    mode = next === 'short' ? 'short' : 'long';
    try { window.localStorage.setItem(STORE_KEY, mode); } catch (e) { /* private mode */ }
    // The pointer always reaches the panel; only drawing is limited (canDrawAt).
    document.querySelectorAll('.controller').forEach((c) => c.setAttribute('raycaster', 'far', LONG_REACH));
    listeners.forEach((fn) => fn(mode));
}

// Can the pen draw on a board this far (metres) from the controller?
export function canDrawAt(distance) {
    return distance <= reachMetres();
}

export function onReachChange(fn) {
    listeners.push(fn);
}

// The intersection between the controller `raycasterEl` and `el` if `el` (or
// something inside it) is the first thing the controller's ray hits;
// otherwise null.
export function nearestHit(raycasterEl, el) {
    const rc = raycasterEl && raycasterEl.components && raycasterEl.components.raycaster;
    if (!rc || !rc.intersections) return null;
    const first = rc.intersections.find((i) => i.object && i.object.el && i.object.el !== raycasterEl);
    if (!first) return null;
    let e = first.object.el;
    while (e && e !== el) e = e.parentNode && e.parentNode.isEntity ? e.parentNode : null;
    return e === el ? first : null;
}

// For panel controls (colour cylinders, eraser, highlighter, Erase board).
// Calls activate(controllerEl) when the trigger is pulled while `el` is the
// nearest thing that controller's pointer hits. A pointer just passing over
// or touching `el` does nothing. tick() is kept so callers don't change; it
// does nothing now.
export function watchTouch(el, activate) {
    const state = { pointers: [] };

    el.addEventListener('raycaster-intersected', (evt) => {
        if (state.pointers.indexOf(evt.detail.el) === -1) state.pointers.push(evt.detail.el);
    });
    el.addEventListener('raycaster-intersected-cleared', (evt) => {
        state.pointers = state.pointers.filter((p) => p !== evt.detail.el);
    });
    document.querySelectorAll('.controller').forEach((controller) => {
        controller.addEventListener('triggerdown', () => {
            if (state.pointers.indexOf(controller) !== -1 && nearestHit(controller, el)) activate(controller);
        });
    });

    return {
        pointer: () => state.pointers[0] || null,
        tick: () => {}
    };
}
