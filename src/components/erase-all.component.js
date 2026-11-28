// The red "Erase board" box. Point at it and pull the trigger (three times
// in a row, see vr.js) to erase the selected board. A pointer passing over
// it does nothing (see vr/reach.js).
import { watchTouch } from '../vr/reach';

AFRAME.registerComponent('erase-all', {
    schema: {
        color: {
            type: 'color',
            default: 'red'
        }
    },
    init: function () {

        this.el.setAttribute('material', {
            color: this.data.color
        })
        this.touch = watchTouch(this.el, () => {
            this.el.sceneEl.emit('vr-action', { action: 'erase-all' });
            this.el.setAttribute('material', {
                color: 'pink'
            })
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.el.setAttribute('material', {
                color: this.data.color
            })
        });
    },
    tick: function () {
        this.touch.tick();
    }

  });
