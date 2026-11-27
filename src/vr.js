require('aframe');
require('aframe-environment-component');
require('./components/texture-painter.component');
require('./components/color-picker.component');
require('./components/size-smaller.component');
require('./components/size-bigger.component');
require('./components/eraser-picker.component');
require('./components/erase-all.component');
require('./components/intersection-visual.component');
require('./components/room-number.component');
require('./components/export-image.component');

// Plain button for the non-immersive (desktop/phone) view of the VR page.
window.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('vr-export-image');
    if (!button) return;
    button.addEventListener('click', () => {
        const painter = document.querySelector('[texture-painter]');
        if (painter && painter.components['texture-painter']) {
            painter.components['texture-painter'].exportImage();
        }
    });
});