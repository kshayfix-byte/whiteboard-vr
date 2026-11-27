// A guard for risky buttons: the action only runs after `count` presses in
// a row, each within `windowMs` of the last. Used by "Remove whiteboard".
//
//   const guard = createMultiClick({ count: 3, onProgress, onConfirm, onReset });
//   button.addEventListener('click', () => guard.press(boardId));
//
// Pressing for a different target (e.g. after switching boards) starts over.
export function createMultiClick(options) {
    const count = options.count || 3;
    const windowMs = options.windowMs || 3000;
    let presses = 0;
    let target = null;
    let timer = null;

    function reset(notify) {
        presses = 0;
        target = null;
        clearTimeout(timer);
        if (notify !== false && options.onReset) options.onReset();
    }

    function press(newTarget) {
        if (presses && newTarget !== target) reset(false);
        target = newTarget;
        presses += 1;
        clearTimeout(timer);
        if (presses >= count) {
            const t = target;
            reset(false);
            options.onConfirm(t);
            return;
        }
        if (options.onProgress) options.onProgress(count - presses, target);
        timer = setTimeout(() => reset(true), windowMs);
    }

    return { press: press, reset: reset };
}
