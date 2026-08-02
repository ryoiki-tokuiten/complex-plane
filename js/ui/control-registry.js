export function controlKeyFromId(id) {
    return String(id)
        .replace(/[-_]+([A-Za-z0-9])/g, (_, character) => character.toUpperCase())
        .replace(/(\d)([a-z])/g, (_, digit, character) => `${digit}${character.toUpperCase()}`);
}

export function registerControls(root, target) {
    root.querySelectorAll('[id]').forEach(element => {
        target[controlKeyFromId(element.id)] = element;
    });
    return target;
}
