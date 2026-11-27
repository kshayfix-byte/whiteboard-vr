// The red "Erase All" box. As in the original, touching it with the laser
// erases a board; with several boards it erases the selected one (vr.js
// handles the `erase-all` action).
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
        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;
            this.el.sceneEl.emit('vr-action', { action: 'erase-all' });
            this.el.setAttribute('material', {
                color: 'pink'
            })
        });
        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.raycasterObj = null;
            this.el.setAttribute('material', {
                color: this.data.color
            })
        });
    }

  });
