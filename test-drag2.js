const siblings = [
    { id: 'A', rect: { top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200 } },
    { id: 'B', rect: { top: 200, bottom: 400, left: 0, right: 800, width: 800, height: 200 } }
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

    // For vertical stacks, isBefore based on mouseX doesn't work well!
    // E.g. if I drag to X=600, Y=100 (over A), mouseX > cx (400), so isBefore=false, so insertAfter A!
    // That would place it AFTER A, which is BEFORE B. But it's visually over A!
    const cx = closestSibling.rect.left + closestSibling.rect.width / 2;
    const cy = closestSibling.rect.top + closestSibling.rect.height / 2;
    
    // Instead of just mouseX, we should use a 2D heuristic.
    // If it's a flex row layout, left-to-right, then top-to-bottom.
    // So if mouseY is in the top half of the sibling, it's BEFORE.
    // If mouseY is in the bottom half of the sibling, it's AFTER?
    // Let's test standard Euclidean + quadrant logic.
    let isBefore = false;
    
    // Calculate angle or just simple halves.
    // Since flex-wrap flows left to right, we care primarily about X, but if items are full-width, Y matters more.
    // Actually, comparing to the center:
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    
    // If the aspect ratio of the rect is wide, Y is more important?
    // Actually, a simple line from top-right to bottom-left: y = -x
    // If we normalize by width and height:
    const nx = dx / closestSibling.rect.width; // -0.5 to 0.5
    const ny = dy / closestSibling.rect.height; // -0.5 to 0.5
    
    // The diagonal from top-right to bottom-left is ny = -nx.
    // Everything above/left of this diagonal is "before".
    // Everything below/right of this diagonal is "after".
    isBefore = (nx + ny) < 0;

    return isBefore ? `insertBefore ${closestSibling.id}` : `insertAfter ${closestSibling.id}`;
}

console.log("Drag over left of A (X=100, Y=100):", getInsertion(100, 100));
console.log("Drag over right of A (X=700, Y=100):", getInsertion(700, 100));
console.log("Drag over top of A (X=400, Y=50):", getInsertion(400, 50));
console.log("Drag over bottom of A (X=400, Y=150):", getInsertion(400, 150));
