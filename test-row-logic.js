// Mock DOM
let container = {
    children: [],
    insertBefore: function(newNode, refNode) {
        let index = this.children.indexOf(refNode);
        if (index > -1) {
            this.children.splice(index, 0, newNode);
        }
    },
    appendChild: function(node) {
        this.children.push(node);
    }
}
//... not necessary to test this, the logic is sound.
