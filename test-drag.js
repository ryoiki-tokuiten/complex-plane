const siblings = [
    { id: 'A', rect: { top: 0, bottom: 200, left: 0, right: 200, width: 200, height: 200 } },
    { id: 'B', rect: { top: 0, bottom: 200, left: 200, right: 400, width: 200, height: 200 } },
    { id: 'C', rect: { top: 0, bottom: 200, left: 400, right: 600, width: 200, height: 200 } }
];

function getInsertion(mouseX, mouseY) {
    let closestSibling = null;
    let minDistance = Infinity;
    
    siblings.forEach(sibling => {
        const cx = sibling.rect.left + sibling.rect.width / 2;
        const cy = sibling.rect.top + sibling.rect.height / 2;
        const dist = Math.hypot(mouseX - cx, mouseY - cy);
        if (dist < minDistance) {
            minDistance = dist;
            closestSibling = sibling;
        }
    });

    if (!closestSibling) return 'append';

    const cx = closestSibling.rect.left + closestSibling.rect.width / 2;
    const isBefore = mouseX < cx;
    
    return isBefore ? `insertBefore ${closestSibling.id}` : `insertAfter ${closestSibling.id}`;
}

console.log("Drag C under A (X=100, Y=300):", getInsertion(100, 300));
console.log("Drag C under B (X=300, Y=300):", getInsertion(300, 300));
console.log("Drag C over left A (X=50, Y=100):", getInsertion(50, 100));
console.log("Drag C over right A (X=150, Y=100):", getInsertion(150, 100));
