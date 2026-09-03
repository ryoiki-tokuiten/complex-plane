export function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlain(item)]));
}
