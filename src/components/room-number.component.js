
import { MeshText2D, textAlign } from 'three-text2d'

AFRAME.registerComponent('room-number', {
    schema: {
        color: { type: 'color', default: "#000" },
      },
    init: function() {        
        let room = (this.getParameterByName('room') || '').toUpperCase();
        const group = new THREE.Group();
        this.titleText = new MeshText2D("Room: " + room, { align: textAlign.left,  font: '64px Arial', fillStyle: this.data.color , antialias: true });
        this.titleText.scale.set(0.001,0.001,0.001);
        group.add(this.titleText);
        this.el.setObject3D('mesh',group);

        this.nameText = new MeshText2D(" ", { align: textAlign.left,  font: '40px Arial', fillStyle: this.data.color , antialias: true });
        this.nameText.scale.set(0.001,0.001,0.001);
        // Below the room line and a little in front of it: the two see-through
        // text planes used to overlap at the same depth and flicker (bug 36).
        this.nameText.position.set(0, -0.085, 0.003);
        group.add(this.nameText);
        this.el.sceneEl.addEventListener('board-renamed', (evt) => {
            const text = evt.detail.name || " ";
            if (this.nameText.text !== text) this.nameText.text = text; // redraw only on a change
        });
    },
    getParameterByName: function(name, url) {
        if (!url) url = window.location.href;
        name = name.replace(/[\[\]]/g, '\\$&');
        var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
            results = regex.exec(url);
        if (!results) return null;
        if (!results[2]) return '';
        return decodeURIComponent(results[2].replace(/\+/g, ' '));
    }
});