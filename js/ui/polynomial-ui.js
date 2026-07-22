import { state } from '../store/state.js';

export function initializePolynomialCoeffs(n, preserveExisting = false) {
    const previous = preserveExisting ? state.polynomialCoeffs : [];
    state.polynomialCoeffs = Array.from({ length: n + 1 }, (_, index) =>
        previous[index] ?? {
            re: Number(n <= 1 ? index === n : index === 0 || index === n),
            im: 0
        }
    );
}
