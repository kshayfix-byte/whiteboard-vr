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
// Things that used to react to a mere touch (colour cylinders, eraser,
// Erase board) still do when the pointer touches them from within NEAR_REACH.
// From further away they need a trigger press, so sweeping the pointer across
// the tray can't change your colour or wipe a board by accident.

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
    document.querySelectorAll('.controller').forEach((c) => c.setAttribute('raycaster', 'far', reachMetres()));
    listeners.forEach((fn) => fn(mode));
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

// For things that react when the pointer touches them (colour cylinders,
// eraser, Erase board). Calls activate(controllerEl) once per touch when the
// pointer touches `el` from within NEAR_REACH, or when the trigger is pulled
// while `el` is the nearest thing the pointer hits. Call tick() every frame.
export function watchTouch(el, activate) {
    const state = { pointers: [], touched: false };

    el.addEventListener('raycaster-intersected', (evt) => {
        if (state.pointers.indexOf(evt.detail.el) === -1) state.pointers.push(evt.detail.el);
    });
    el.addEventListener('raycaster-intersected-cleared', (evt) => {
        state.pointers = state.pointers.filter((p) => p !== evt.detail.el);
        if (!state.pointers.length) state.touched = false;
    });
    document.querySelectorAll('.controller').forEach((controller) => {
        controller.addEventListener('triggerdown', () => {
            if (state.pointers.indexOf(controller) !== -1 && nearestHit(controller, el)) activate(controller);
        });
    });

    return {
        pointer: () => state.pointers[0] || null,
        tick: () => {
            if (!state.pointers.length) return;
            const near = state.pointers.find((p) => {
                const hit = nearestHit(p, el);
                return hit && hit.distance <= NEAR_REACH;
            });
            if (near && !state.touched) {
                state.touched = true;
                activate(near);
            } else if (!near) {
                state.touched = false;
            }
        }
    };
}
