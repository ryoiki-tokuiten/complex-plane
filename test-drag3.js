const siblings = [
    { id: 'A', rect: { top: 0, bottom: 200, left: 0, right: 200, width: 200, height: 200 } },
    { id: 'B', rect: { top: 0, bottom: 200, left: 200, right: 400, width: 200, height: 200 } },
    { id: 'C', rect: { top: 200, bottom: 400, left: 0, right: 200, width: 200, height: 200 } },
    { id: 'D', rect: { top: 200, bottom: 400, left: 200, right: 400, width: 200, height: 200 } }
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

    const cx = closestSibling.rect.left + closestSibling.rect.width / 2;
    const cy = closestSibling.rect.top + closestSibling.rect.height / 2;
    const nx = (mouseX - cx) / closestSibling.rect.width;
    const ny = (mouseY - cy) / closestSibling.rect.height;
    
    const isBefore = (nx + ny) < 0;

    return isBefore ? `insertBefore ${closestSibling.id}` : `insertAfter ${closestSibling.id}`;
}

// Drag under A (over C)
console.log("Drag under A (X=100, Y=300):", getInsertion(100, 300));
// Drag directly between A and C (X=100, Y=200). It's equidistant. Let's see.
console.log("Drag between A and C (X=100, Y=199):", getInsertion(100, 199));
console.log("Drag between A and C (X=100, Y=201):", getInsertion(100, 201));
