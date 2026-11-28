// The red "Erase board" box. Point at it and pull the trigger (three times
// in a row, see vr.js) to erase the selected board. A pointer passing over
// it does nothing (see vr/reach.js).
import { watchTouch } from '../vr/reach';
import { createLook, COLORS } from '../vr/button-look';

AFRAME.registerComponent('erase-all', {
    schema: {
        color: {
            type: 'color',
            default: 'red'
        }
    },
    init: function () {

        this.look = createLook(this.el, { color: COLORS.danger });
        this.touch = watchTouch(this.el, () => {
            this.look.flash();
            this.el.sceneEl.emit('vr-action', { action: 'erase-all' });
        });
    },
    tick: function () {
        this.touch.tick();
    }

  });
