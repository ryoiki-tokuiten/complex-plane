import { state } from '../store/state.js';
import { Complex } from '../math-utils.js';
import { ZERO_POLE_EPSILON } from '../constants/numerical.js';

/**
 * Evaluates a polynomial P(z) = a_n z^n + ... + a_1 z + a_0 at a given complex point z.
 * @param {Complex[]} polyCoeffsComplex - Array of complex polynomial coefficients [a_n, ..., a_0].
 * @param {Complex} z - The complex point at which to evaluate the polynomial.
 * @returns {Complex} P(z).
 */
export function evaluatePolynomial(polyCoeffsComplex, z) {
    let result = new Complex(0, 0);
    const n = polyCoeffsComplex.length - 1;
    for (let i = 0; i <= n; i++) {
        const termCoeff = polyCoeffsComplex[i];
        const powerOfZ = Complex.power(z, n - i);
        result = result.add(termCoeff.multiply(powerOfZ));
    }
    return result;
}

/**
 * Finds the roots of a polynomial using the Durand-Kerner method.
 * @param {number[]} inputCoeffs - Array of polynomial coefficients [a_n, a_{n-1}, ..., a_0].
 *                                Coefficients can be real numbers.
 * @returns {Complex[]} Array of complex roots.
 */
export function findPolynomialRoots_DurandKerner(inputCoeffs) {
    if (!inputCoeffs || inputCoeffs.length === 0) {
        return [];
    }

    
    let currentCoeffs = [...inputCoeffs];
    let firstNonZeroIndex = currentCoeffs.findIndex(c => c !== 0);

    if (firstNonZeroIndex === -1) {
        
        
        return [];
    }

    if (firstNonZeroIndex > 0) {
        
        currentCoeffs = currentCoeffs.slice(firstNonZeroIndex);
    }

    if (currentCoeffs.length === 0) { 
        return [];
    }

    
    const normalizerValue = currentCoeffs[0];
    const normalizerComplex = new Complex(normalizerValue, 0);

    
    const polyCoeffsComplex = currentCoeffs.map(c => new Complex(c, 0).divide(normalizerComplex));

    let n = polyCoeffsComplex.length - 1;
    if (n < 1) { 
        return [];
    }

    let roots = [];
    
    
    
    let p = new Complex(0.4, 0.9);
    for (let i = 0; i < n; i++) {
        roots.push(Complex.power(p, i));
    }

    const maxIterations = 1000; 
    const tolerance = 1e-7;     

    for (let iter = 0; iter < maxIterations; iter++) {
        let allRootsConverged = true;
        let newRoots = roots.map(r => r.clone()); 

        for (let i = 0; i < n; i++) {
            let currentRoot = roots[i];
            let pVal = evaluatePolynomial(polyCoeffsComplex, currentRoot);

            let denominatorProduct = new Complex(1, 0);
            for (let j = 0; j < n; j++) {
                if (i !== j) {
                    denominatorProduct = denominatorProduct.multiply(currentRoot.subtract(roots[j]));
                }
            }

            if (denominatorProduct.abs() < 1e-20) { 
                
                
                
                continue;
            }

            let correction = pVal.divide(denominatorProduct);
            newRoots[i] = currentRoot.subtract(correction);

            if (correction.abs() > tolerance) {
                allRootsConverged = false;
            }
        }
        roots = newRoots;

        if (allRootsConverged) {
            
            return roots;
        }
    }

    console.warn("Durand-Kerner did not converge within the maximum iterations.");
    return roots; 
}

/**
 * Finds roots of a general complex function f(z) using recursive subdivision
 * based on the Argument Principle (winding number).
 *
 * @param {function(Complex): Complex} func - The complex function f(z).
 * @param {{xMin: number, xMax: number, yMin: number, yMax: number}} bounds -
 *   The search rectangle { xMin, xMax, yMin, yMax }.
 * @param {number} N_initial_grid_search_points - Number of points per
 *   subdivision side.
 * @returns {Complex[]} Array of complex numbers representing the found zeros.
 */
export function findGeneralRoots_Subdivision(func, bounds, N_initial_grid_search_points) {
    const roots = [];
    const queue = [{ bounds: bounds, depth: 0 }]; 

    const MAX_DEPTH = state.currentFunction === 'zeta' ? 12 : 10; 
    const MIN_SIZE_THRESHOLD = 1e-5; 
    const WINDING_NUM_THRESHOLD = 0.5; 
    
    const NUM_POINTS_PER_SIDE_SUBDIVISION = (typeof N_initial_grid_search_points === 'number' && N_initial_grid_search_points > 10) ? N_initial_grid_search_points : 40;


    let iterations = 0;
    const MAX_ITERATIONS = 2000; 

    while (queue.length > 0 && iterations < MAX_ITERATIONS) {
        iterations++;
        const current = queue.shift();
        const currentBounds = current.bounds;
        const depth = current.depth;

        const { xMin, xMax, yMin, yMax } = currentBounds;
        const width = xMax - xMin;
        const height = yMax - yMin;

        
        const windingNumber = calculateWindingNumber(func, currentBounds, NUM_POINTS_PER_SIDE_SUBDIVISION);

        if (Math.abs(windingNumber) > WINDING_NUM_THRESHOLD) {
            if ((width < MIN_SIZE_THRESHOLD && height < MIN_SIZE_THRESHOLD) || depth >= MAX_DEPTH) {
                const rootX = xMin + width / 2;
                const rootY = yMin + height / 2;
                const potentialRoot = new Complex(rootX, rootY);

                
                if (!roots.some(r => r.subtract(potentialRoot).abs() < MIN_SIZE_THRESHOLD)) {
                    
                    const funcValAtRoot = func(potentialRoot);
                    if (funcValAtRoot.abs() < ZERO_POLE_EPSILON * 10) { 
                        roots.push(potentialRoot);
                    }
                }
            } else {
                
                const xMid = xMin + width / 2;
                const yMid = yMin + height / 2;

                const quadrants = [
                    { bounds: { xMin: xMin, xMax: xMid, yMin: yMin, yMax: yMid }, depth: depth + 1 }, 
                    { bounds: { xMin: xMid, xMax: xMax, yMin: yMin, yMax: yMid }, depth: depth + 1 }, 
                    { bounds: { xMin: xMin, xMax: xMid, yMin: yMid, yMax: yMax }, depth: depth + 1 }, 
                    { bounds: { xMin: xMid, xMax: xMax, yMin: yMid, yMax: yMax }, depth: depth + 1 }  
                ];
                quadrants.forEach(quad => queue.push(quad));
            }
        }
    }
    if (iterations >= MAX_ITERATIONS) {
        console.warn("findGeneralRoots_Subdivision reached max iterations.");
    }
    return roots;
}
















/**
 * Calculates the winding number of a function f(z) around the origin
 * for a rectangular contour.
 * N = (1/2π) * Δarg(f(z))
 * This indicates N_zeros - N_poles inside the contour.
 *
 * @param {function(Complex): Complex} func - The complex function f(z).
 * @param {{xMin: number, xMax: number, yMin: number, yMax: number}} rectBounds - The rectangle.
 * @param {number} numIntegrationPointsPerSide - Number of points for numerical integration along each side.
 * @returns {number} The estimated winding number (should be close to an integer).
 */
export function calculateWindingNumber(func, rectBounds, numIntegrationPointsPerSide) {
    const { xMin, xMax, yMin, yMax } = rectBounds;
    let totalArgChange = 0;
    let prevArg = 0;

    
    
    
    
    

    let currentPoint;
    let funcVal;

    
    currentPoint = new Complex(xMin, yMin);
    funcVal = func(currentPoint);
    prevArg = funcVal.arg();

    
    const dx = (xMax - xMin) / numIntegrationPointsPerSide;
    const dy = (yMax - yMin) / numIntegrationPointsPerSide;

    
    for (let i = 1; i <= numIntegrationPointsPerSide; i++) {
        currentPoint = new Complex(xMin + i * dx, yMin);
        funcVal = func(currentPoint);
        let currentArg = funcVal.arg();
        let deltaArg = currentArg - prevArg;
        
        if (deltaArg > Math.PI) deltaArg -= 2 * Math.PI;
        if (deltaArg < -Math.PI) deltaArg += 2 * Math.PI;
        totalArgChange += deltaArg;
        prevArg = currentArg;
    }

    
    for (let i = 1; i <= numIntegrationPointsPerSide; i++) {
        currentPoint = new Complex(xMax, yMin + i * dy);
        funcVal = func(currentPoint);
        let currentArg = funcVal.arg();
        let deltaArg = currentArg - prevArg;
        if (deltaArg > Math.PI) deltaArg -= 2 * Math.PI;
        if (deltaArg < -Math.PI) deltaArg += 2 * Math.PI;
        totalArgChange += deltaArg;
        prevArg = currentArg;
    }

    
    for (let i = 1; i <= numIntegrationPointsPerSide; i++) {
        currentPoint = new Complex(xMax - i * dx, yMax);
        funcVal = func(currentPoint);
        let currentArg = funcVal.arg();
        let deltaArg = currentArg - prevArg;
        if (deltaArg > Math.PI) deltaArg -= 2 * Math.PI;
        if (deltaArg < -Math.PI) deltaArg += 2 * Math.PI;
        totalArgChange += deltaArg;
        prevArg = currentArg;
    }

    
    for (let i = 1; i <= numIntegrationPointsPerSide; i++) {
        currentPoint = new Complex(xMin, yMax - i * dy);
        funcVal = func(currentPoint);
        let currentArg = funcVal.arg();
        let deltaArg = currentArg - prevArg;
        if (deltaArg > Math.PI) deltaArg -= 2 * Math.PI;
        if (deltaArg < -Math.PI) deltaArg += 2 * Math.PI;
        totalArgChange += deltaArg;
        prevArg = currentArg;
    }

    return totalArgChange / (2 * Math.PI);
}

