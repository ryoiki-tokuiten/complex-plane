function findDropTarget(mouseY, mouseX, rows) {
    const GAP = 14;
    
    // Check if directly inside any row
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (mouseY >= r.top - GAP && mouseY <= r.bottom + GAP) {
            return { type: 'inside_row', rowIndex: i };
        }
    }
    
    // If above first row
    if (mouseY < rows[0].top - GAP) {
        return { type: 'new_row_at', insertBeforeIndex: 0 };
    }
    
    // If below last row
    if (mouseY > rows[rows.length - 1].bottom + GAP) {
        return { type: 'new_row_at', insertBeforeIndex: rows.length };
    }
    
    // If between two rows
    for (let i = 0; i < rows.length - 1; i++) {
        if (mouseY > rows[i].bottom + GAP && mouseY < rows[i+1].top - GAP) {
            return { type: 'new_row_at', insertBeforeIndex: i + 1 };
        }
    }
    
    return { type: 'inside_row', rowIndex: 0 };
}

const rows = [
    { top: 100, bottom: 300 }, // row 0: height 200
    { top: 350, bottom: 550 }  // row 1: height 200, gap is 50px (from 300 to 350)
];

console.log("Mouse at 200 (inside row 0):", findDropTarget(200, 100, rows));
console.log("Mouse at 50 (above row 0):", findDropTarget(50, 100, rows));
console.log("Mouse at 325 (between row 0 and 1):", findDropTarget(325, 100, rows));
console.log("Mouse at 400 (inside row 1):", findDropTarget(400, 100, rows));
console.log("Mouse at 600 (below row 1):", findDropTarget(600, 100, rows));
