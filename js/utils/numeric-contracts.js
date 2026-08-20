export function requireFiniteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite.`);
    return number;
}

export function requireInteger(value, label) {
    const number = requireFiniteNumber(value, label);
    if (!Number.isInteger(number)) throw new Error(`${label} must be an integer.`);
    return number;
}

export function requireFiniteComplex(value, label) {
    if (!Number.isFinite(value?.re) || !Number.isFinite(value?.im)) {
        throw new Error(`${label} requires finite real and imaginary components.`);
    }
    return value;
}
