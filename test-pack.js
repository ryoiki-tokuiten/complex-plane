class PackingEngine {
    constructor() {
        this.boxes = [];
        this.gap = 16;
    }
    
    addBox(id, x, y, w, h) {
        this.boxes.push({id, x, y, w, h});
    }

    resolveOverlaps(activeId) {
        let iterations = 0;
        let overlapsFound = true;
        
        while (overlapsFound && iterations < 100) {
            overlapsFound = false;
            iterations++;
            
            for (let i = 0; i < this.boxes.length; i++) {
                for (let j = 0; j < this.boxes.length; j++) {
                    if (i === j) continue;
                    let a = this.boxes[i];
                    let b = this.boxes[j];
                    
                    if (this.checkOverlap(a, b)) {
                        overlapsFound = true;
                        // a overlaps b. If a is the active one, push b.
                        // If neither is active, push the one that's further along.
                        let pusher = (a.id === activeId) ? a : (b.id === activeId ? b : a);
                        let pushed = (pusher === a) ? b : a;
                        
                        // Push along the axis where centers are furthest apart?
                        let cx1 = pusher.x + pusher.w/2;
                        let cy1 = pusher.y + pusher.h/2;
                        let cx2 = pushed.x + pushed.w/2;
                        let cy2 = pushed.y + pushed.h/2;
                        
                        let dx = cx2 - cx1;
                        let dy = cy2 - cy1;
                        
                        if (Math.abs(dx) > Math.abs(dy)) {
                            // Push horizontally
                            if (dx > 0) {
                                pushed.x = pusher.x + pusher.w + this.gap;
                            } else {
                                pushed.x = pusher.x - pushed.w - this.gap;
                            }
                        } else {
                            // Push vertically
                            if (dy > 0) {
                                pushed.y = pusher.y + pusher.h + this.gap;
                            } else {
                                pushed.y = pusher.y - pushed.h - this.gap;
                            }
                        }
                    }
                }
            }
        }
        console.log("Resolved in", iterations, "iterations");
    }
    
    checkOverlap(a, b) {
        return !(a.x + a.w + this.gap <= b.x ||
                 b.x + b.w + this.gap <= a.x ||
                 a.y + a.h + this.gap <= b.y ||
                 b.y + b.h + this.gap <= a.y);
    }
}

let engine = new PackingEngine();
engine.addBox('A', 0, 0, 200, 200);
engine.addBox('B', 216, 0, 200, 200);
engine.addBox('C', 0, 216, 200, 200);

console.log("Initial", engine.boxes);
// Drag B on top of A
let b = engine.boxes.find(b => b.id === 'B');
b.x = 100;
b.y = 10;
engine.resolveOverlaps('B');
console.log("After dragging B onto A", engine.boxes);
