// One look for every control on the VR tool panel (Kate's round-2 notes):
//
// - Normal: teal (red for the risky Erase board / Remove board).
// - Pointed at: orange, the same for every control. The colour discs keep
//   their own colour (their colour is what they pick).
// - Active: blue while that mode is on (the highlighter or an eraser in use,
//   standing inside a 360 board). An active colour disc is a little bigger.
// - Pressed: a quick white flash and the control grows for a moment, then
//   goes back to how it was.
// - Can't be used now: grey and see-through.
//
//   const look = createLook(el, { color: COLORS.normal });
//   look.flash();             // after a press
//   look.setActive(true);     // a mode is on
//   look.setEnabled(false);   // greyed out
//
// Options: color (the normal colour), keepColor (true for colour discs: never
// change their colour), activeGrow (how much bigger an active control is,
// default 1).

export const COLORS = {
    normal: '#03B594',
    danger: '#C0392B',
    hover: '#FFA500',
    active: '#3BA3FF',
    flash: '#FFFFFF',
    disabled: '#7A7A7A'
};

export const FLASH_MS = 220;   // how long a press shows
export const PRESS_GROW = 1.35; // how much bigger a pressed control gets

// The colour a control should show. Exported for the tests.
export function lookColor(state, opts) {
    if (opts.keepColor) return opts.color;
    if (!state.enabled) return COLORS.disabled;
    if (state.flashing) return COLORS.flash;
    if (state.hovered) return COLORS.hover;
    if (state.active) return COLORS.active;
    return opts.color || COLORS.normal;
}

// How much bigger than normal a control should be. Exported for the tests.
export function lookGrow(state, opts) {
    if (state.flashing) return PRESS_GROW;
    if (state.active) return opts.activeGrow || 1;
    return 1;
}

export function createLook(el, options) {
    const opts = Object.assign({ color: COLORS.normal, keepColor: false, activeGrow: 1 }, options || {});
    const state = { hovered: false, active: false, enabled: true, flashing: false };
    const pointers = new Set();
    let base = null;   // the control's own scale, read once it is ready
    let timer = null;

    function paint() {
        if (!opts.keepColor) {
            el.setAttribute('material', {
                color: lookColor(state, opts),
                opacity: state.enabled ? 1 : 0.7,
                transparent: !state.enabled
            });
        } else {
            el.setAttribute('material', 'color', opts.color);
        }
        const obj = el.object3D;
        if (!obj || !el.hasLoaded) return;   // its own scale isn't applied yet
        if (!base) base = obj.scale.clone();
        const k = lookGrow(state, opts);
        obj.scale.set(base.x * k, base.y * k, base.z * k);
    }

    el.addEventListener('raycaster-intersected', (evt) => {
        pointers.add(evt.detail.el);
        state.hovered = true;
        paint();
    });
    el.addEventListener('raycaster-intersected-cleared', (evt) => {
        pointers.delete(evt.detail.el);
        state.hovered = pointers.size > 0;
        paint();
    });
    // Read the scale from vr.html once the entity has applied it.
    if (el.hasLoaded) paint();
    else el.addEventListener('loaded', paint, { once: true });

    return {
        flash: () => {
            state.flashing = true;
            paint();
            clearTimeout(timer);
            timer = setTimeout(() => { state.flashing = false; paint(); }, FLASH_MS);
        },
        setActive: (on) => { if (state.active !== !!on) { state.active = !!on; paint(); } },
        setEnabled: (on) => { if (state.enabled !== !!on) { state.enabled = !!on; paint(); } },
        setColor: (color) => { opts.color = color; paint(); },
        paint: paint
    };
}
