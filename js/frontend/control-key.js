export const controlKeyFromId = id => String(id)
    .replace(/[-_]+([A-Za-z0-9])/g, (_, character) => character.toUpperCase())
    .replace(/(\d)([a-z])/g, (_, digit, character) => `${digit}${character.toUpperCase()}`);
