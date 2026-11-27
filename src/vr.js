require('aframe');
require('aframe-environment-component');
const painterModule = require('./components/texture-painter.component');
require('./components/color-picker.component');
require('./components/size-smaller.component');
require('./components/size-bigger.component');
require('./components/eraser-picker.component');
require('./components/erase-all.component');
require('./components/intersection-visual.component');
require('./components/room-number.component');
require('./components/vr-button.component');
import { createSaveControls } from './save-controls';
import { createRecoveryUI } from './recovery-ui';

const { socket, room, boardId } = painterModule;

function painter() {
    const el = document.querySelector('[texture-painter]');
    return el && el.components['texture-painter'];
}

window.addEventListener('DOMContentLoaded', () => {
    const statusEl = document.getElementById('vr-save-status');
    const sceneStatus = document.getElementById('vr-status-text');
    const saveAllButton = document.getElementById('vr-save-all-box');
    let sceneTimer = null;

    function showInScene(text) {
        if (!sceneStatus) return;
        sceneStatus.setAttribute('value', text);
        clearTimeout(sceneTimer);
        sceneTimer = setTimeout(() => sceneStatus.setAttribute('value', ''), 5000);
    }

    const controls = createSaveControls({
        socket: socket,
        room: room,
        boardId: boardId,
        elements: {
            name: document.getElementById('vr-board-name'),
            state: document.getElementById('vr-board-state'),
            status: statusEl,
            save: document.getElementById('vr-save'),
            rename: document.getElementById('vr-rename'),
            saveAll: document.getElementById('vr-save-all')
        },
        onChange: (board, info) => {
            if (saveAllButton) saveAllButton.setAttribute('vr-button', 'enabled', !!(info && info.allNamed));
        }
    });

    // Mirror on-screen status messages into the scene so they're visible in a headset.
    if (statusEl && window.MutationObserver) {
        new MutationObserver(() => { if (statusEl.textContent) showInScene(statusEl.textContent); })
            .observe(statusEl, { childList: true, characterData: true, subtree: true });
    }

    const scene = document.querySelector('a-scene');

    // Browsers can't show a text box inside a headset, so to type a name we
    // leave VR, show the normal 2D name box, and the user re-enters VR after.
    function askOutsideVR(ask) {
        if (!scene.is('vr-mode')) {
            ask();
            return;
        }
        scene.addEventListener('exit-vr', () => {
            setTimeout(() => {
                ask();
                controls.setStatus('Press the VR button to go back into VR.');
            }, 300);
        }, { once: true });
        showInScene('Leaving VR so you can type a name\u2026');
        scene.exitVR();
    }

    // First choice for naming in a headset: open a small 2D page in a new
    // browser window. Browsers only allow new windows right after a user
    // action, and in VR that's the controller's "select" event, which fires
    // when the trigger is released. If no window opens, fall back to leaving
    // VR and showing the normal name box.
    let pendingName = null;
    let pendingTimer = null;

    function openNameWindow(action) {
        const url = 'name.html?room=' + encodeURIComponent(room) + '&board=' + encodeURIComponent(boardId) + '&action=' + action;
        let win = null;
        try {
            win = window.open(url, 'whiteboard-name', 'width=520,height=420');
        } catch (e) {
            win = null;
        }
        if (win) showInScene('Type the name in the window that just opened.');
        return !!win;
    }

    function exportNow() {
        if (painter()) painter().exportImage();
    }

    function fallback(action) {
        if (action === 'export') return exportNow();
        askOutsideVR(() => (action === 'rename' ? controls.renameCurrent() : controls.saveCurrent(true)));
    }

    // Wait for the trigger release ("select") to run the action; used for
    // naming and for exports.
    function askForName(action) {
        if (!scene.is('vr-mode')) {
            fallback(action);
            return;
        }
        pendingName = action;
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(() => {
            if (pendingName) {
                const a = pendingName;
                pendingName = null;
                fallback(a);
            }
        }, 1500);
    }

    scene.addEventListener('enter-vr', () => {
        const xr = scene.renderer && scene.renderer.xr;
        const session = xr && xr.getSession && xr.getSession();
        if (!session) return;
        session.addEventListener('select', () => {
            if (!pendingName) return;
            const action = pendingName;
            pendingName = null;
            clearTimeout(pendingTimer);
            if (action === 'export') exportNow(); // downloads also need a user action
            else if (!openNameWindow(action)) fallback(action);
        });
    });

    scene.addEventListener('vr-action', (evt) => {
        const action = evt.detail.action;
        if (action === 'export') {
            if (scene.is('vr-mode')) askForName('export');
            else exportNow();
        } else if (action === 'save') {
            const result = controls.saveCurrent(false);
            if (result.needsName) askForName('save');
        } else if (action === 'rename') {
            askForName('rename');
        } else if (action === 'save-all') {
            controls.saveAll();
        }
    });

    // Offer to restore unsaved whiteboards left over from a crash or restart.
    const recovery = createRecoveryUI({ room: room, page: 'vr.html' });
    const recoverButton = document.getElementById('vr-recover');
    recovery.onCount((n) => {
        recoverButton.style.display = n ? '' : 'none';
        recoverButton.textContent = 'Restore unsaved (' + n + ')';
    });
    recoverButton.addEventListener('click', () => recovery.open());
    recovery.check(true);

    const exportButton = document.getElementById('vr-export-image');
    if (exportButton) exportButton.addEventListener('click', () => { if (painter()) painter().exportImage(); });
});
