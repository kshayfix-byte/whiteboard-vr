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

    document.querySelector('a-scene').addEventListener('vr-action', (evt) => {
        const action = evt.detail.action;
        if (action === 'export') {
            if (painter()) painter().exportImage();
        } else if (action === 'save') {
            const result = controls.saveCurrent(false);
            if (result.needsName) {
                showInScene('Name this board first: take off the headset and press Save,\nor press Save on the 2D page.');
            }
        } else if (action === 'save-all') {
            controls.saveAll();
        }
    });

    const exportButton = document.getElementById('vr-export-image');
    if (exportButton) exportButton.addEventListener('click', () => { if (painter()) painter().exportImage(); });
});
