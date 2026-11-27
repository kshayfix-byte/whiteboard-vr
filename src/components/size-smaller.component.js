import { tools, setTool } from '../vr/session';
import { nearestHit } from '../vr/reach';


AFRAME.registerComponent('size-smaller', {
    schema: {
        color: {
            type: 'color',
            default: 'white'
        }
    },
    init: function () {

        this.decreasing = false;

        var controllers = document.querySelectorAll(".controller");
        controllers.forEach((controller) => {
            controller.addEventListener('triggerdown', evt => {
                if (!(this.decreasing) && nearestHit(controller, this.el)) {
                    this.decreasing = true;
                    let newSize = tools.size - 10;
                    if (newSize < 5) {
                        newSize = 5;
                    }
                    setTool({ size: newSize });
                    this.el.setAttribute('material', {
                        color: 'red'
                    })
                }
            });
            controller.addEventListener('triggerup', evt => {
                this.decreasing = false;
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