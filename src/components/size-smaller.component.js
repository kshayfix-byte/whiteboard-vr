// The round "-" next to "Pen size": makes the pen in use thinner (to 5 px).
// The "+" is size-bigger.component.js. Point at it and pull the trigger.
import { tools, setTool } from '../vr/session';
import { watchTouch } from '../vr/reach';
import { createLook } from '../vr/button-look';

export function penSizeButton(name, step) {
    AFRAME.registerComponent(name, {
        init: function () {
            this.look = createLook(this.el);
            this.touch = watchTouch(this.el, () => {
                setTool({ size: Math.min(50, Math.max(5, tools.size + step)) });
                this.look.flash();
            });
        }
    });
}

penSizeButton('size-smaller', -10);
