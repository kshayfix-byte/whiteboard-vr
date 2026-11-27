import { tools, setTool } from '../vr/session';
import { nearestHit } from '../vr/reach';


AFRAME.registerComponent('size-bigger', {
    schema: {
        color: {
            type: 'color',
            default: 'white'
        }
    },
    init: function () {

        this.increasing = false;

        var controllers = document.querySelectorAll(".controller");
        controllers.forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                if (!(this.increasing) && nearestHit(controller, this.el)) {
                    this.increasing = true;
                    let newSize = tools.size + 10;
                    if (newSize > 50) {
                        newSize = 50;
                    }
                    setTool({ size: newSize });
                    this.el.setAttribute('material', {
                        color: 'red'
                    })
                }
            });
            controller.addEventListener('triggerup', evt => {
                this.increasing = false;
                this.el.setAttribute('material', {
                    color: this.data.color
                })
            });
        })
        
        this.el.setAttribute('material', {
            color: this.data.color
        })
        
        this.el.addEventListener('raycaster-intersected', evt => {
            this.raycasterObj = evt.detail.el;   
        });

        this.el.addEventListener('raycaster-intersected-cleared', evt => {
            this.raycasterObj = null;   
        });
    }

  });