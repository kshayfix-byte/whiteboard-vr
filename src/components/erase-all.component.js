// The red "Erase All" box. As in the original, touching it with the laser
// erases a board; with several boards it erases the selected one (vr.js
// handles the `erase-all` action). With the long pointer, a touch only counts
// from within 20 cm; from further away it needs a trigger press, so sweeping
// the pointer past it can't wipe a board (see vr/reach.js).
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
