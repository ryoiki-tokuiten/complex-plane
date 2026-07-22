import { state, zPlaneParams } from '../store/state.js';
import {
    getChainedTransformFunction,
    complexDivide,
    estimateResidue,
    numericDerivativeNthOrder,
    factorial,
    Complex
} from '../math-utils.js';
import { resolveActiveMap } from '../math/active-map.js';
import {
    findPolynomialRoots_DurandKerner,
    findGeneralRoots_Subdivision
} from './root-finding.js';
import { getAlgebraicStructureSignatureShared } from '../rendering/webgl-shared.js';
import {
    CRITICAL_POINT_FIND_GRID_SIZE,
    ZP_CP_CHECK_DISTANCE_FACTOR,
    CRITICAL_POINT_EPSILON,
    ZERO_POLE_GRID_SIZE,
    ZETA_REFLECTION_POINT_RE,
    ZETA_POLE,
    ZERO_POLE_EPSILON,
    POLE_MAGNITUDE_THRESHOLD
} from '../constants/numerical.js';

function buildFeatureDetectionCacheKey() {
    return [
        state.currentFunction,
        state.mapPresentation,
        state.chainingEnabled,
        state.chainCount,
        state.algebraicChainingEnabled,
        getAlgebraicStructureSignatureShared(state.algebraicChainingTerms),
        state.algebraicChainingZExpr || 'z',
        JSON.stringify(state.polynomialCoeffs),
        state.mobiusA?.re, state.mobiusA?.im,
        state.mobiusB?.re, state.mobiusB?.im,
        state.mobiusC?.re, state.mobiusC?.im,
        state.mobiusD?.re, state.mobiusD?.im,
        state.fractionalPowerN,
        zPlaneParams.currentVisXRange?.[0], zPlaneParams.currentVisXRange?.[1],
        zPlaneParams.currentVisYRange?.[0], zPlaneParams.currentVisYRange?.[1]
    ].join('|');
}

let lastCriticalPointsKey = null;
export function findCriticalPoints() {
    const isZPlanar = !state.riemannSphereViewEnabled || state.splitViewEnabled; 
    if (!state.showCriticalPoints || !isZPlanar) {
        state.criticalPoints = [];
        state.criticalValues = [];
        lastCriticalPointsKey = null;
        return;
    }

    const key = buildFeatureDetectionCacheKey();
    if (key === lastCriticalPointsKey) {
        return;
    }
    lastCriticalPointsKey = key;

    state.criticalPoints = [];
    state.criticalValues = [];

    const activeMap = resolveActiveMap();
    const func = activeMap.evaluate;
    const derivative = activeMap.derivative;
    const { currentVisXRange: xR, currentVisYRange: yR } = zPlaneParams;
    
    const cpCheckDist = (xR[1] - xR[0]) / CRITICAL_POINT_FIND_GRID_SIZE * ZP_CP_CHECK_DISTANCE_FACTOR;

    const addCritPoint = (re, im) => {
        const z_crit = { re, im };
        
        if (z_crit.re >= xR[0] - cpCheckDist && z_crit.re <= xR[1] + cpCheckDist &&
            z_crit.im >= yR[0] - cpCheckDist && z_crit.im <= yR[1] + cpCheckDist) {

            let tooClose = state.criticalPoints.some(cp =>
                Math.abs(cp.re - z_crit.re) < cpCheckDist && Math.abs(cp.im - z_crit.im) < cpCheckDist
            );
            if (!tooClose) {
                state.criticalPoints.push(z_crit);
                const val_at_crit = func(z_crit.re, z_crit.im);
                if (!isNaN(val_at_crit.re) && !isNaN(val_at_crit.im) && isFinite(val_at_crit.re) && isFinite(val_at_crit.im)){
                    state.criticalValues.push(val_at_crit);
                } else {
                    state.criticalValues.push({re: NaN, im: NaN}); 
                }
            }
        }
    };

    
    
    if (activeMap.presentation !== 'derivative') {
        if (['exp', 'tan', 'reciprocal', 'ln', 'poincare'].includes(state.currentFunction)) {
            state.criticalPoints = []; state.criticalValues = []; return;
        }

        if (state.currentFunction === 'sin') {
            for (let n = Math.ceil(xR[0] / Math.PI - 0.5) - 1; n <= Math.floor(xR[1] / Math.PI - 0.5) + 1; n++) {
                addCritPoint((n + 0.5) * Math.PI, 0);
            } return;
        }
        if (state.currentFunction === 'cos') {
            for (let n = Math.ceil(xR[0] / Math.PI) - 1; n <= Math.floor(xR[1] / Math.PI) + 1; n++) {
                addCritPoint(n * Math.PI, 0);
            } return;
        }
        if (state.currentFunction === 'sec') {
            for (let n = Math.ceil(xR[0] / Math.PI) - 1; n <= Math.floor(xR[1] / Math.PI) + 1; n++) {
                addCritPoint(n * Math.PI, 0);
            } return;
        }
    }
    

    
    const dx_grid = (xR[1] - xR[0]) / CRITICAL_POINT_FIND_GRID_SIZE;
    const dy_grid = (yR[1] - yR[0]) / CRITICAL_POINT_FIND_GRID_SIZE;

    for (let i = 0; i <= CRITICAL_POINT_FIND_GRID_SIZE; i++) {
        const z_re_eval = xR[0] + i * dx_grid;
        for (let j = 0; j <= CRITICAL_POINT_FIND_GRID_SIZE; j++) {
            const z_im_eval = yR[0] + j * dy_grid;
            const z_test = { re: z_re_eval, im: z_im_eval };

            
            if (state.currentFunction === 'zeta' && !state.zetaContinuationEnabled && z_test.re <= ZETA_REFLECTION_POINT_RE) {
                continue;
            }
            const deriv = derivative(z_test.re, z_test.im);
            if (isNaN(deriv.re) || isNaN(deriv.im) || !isFinite(deriv.re) || !isFinite(deriv.im)) continue;

            const modDerivSq = deriv.re * deriv.re + deriv.im * deriv.im;
            if (modDerivSq < CRITICAL_POINT_EPSILON * CRITICAL_POINT_EPSILON) {
                addCritPoint(z_test.re, z_test.im);
            }
        }
    }
}

let lastZerosPolesKey = null;
export function findZerosAndPoles() {
    const isZPlanar = !state.riemannSphereViewEnabled || state.splitViewEnabled;
    if (!state.showZerosPoles || !isZPlanar) {
        state.zeros = [];
        state.poles = [];
        lastZerosPolesKey = null;
        return;
    }

    const key = buildFeatureDetectionCacheKey();
    if (key === lastZerosPolesKey) {
        return;
    }
    lastZerosPolesKey = key;

    state.zeros = [];
    state.poles = [];

    const funcOriginal = getChainedTransformFunction(state.currentFunction); 
    const { currentVisXRange: xR, currentVisYRange: yR } = zPlaneParams;
    const zpCheckDist = (xR[1] - xR[0]) / ZERO_POLE_GRID_SIZE * ZP_CP_CHECK_DISTANCE_FACTOR; 

    
    const addZero = (re, im, type = 'zero', order = null, residue = null) => {
        const z_zero = { re, im, type, order, residue };
        if (z_zero.re >= xR[0] - zpCheckDist && z_zero.re <= xR[1] + zpCheckDist &&
            z_zero.im >= yR[0] - zpCheckDist && z_zero.im <= yR[1] + zpCheckDist) {
            let tooClose = state.zeros.some(z => Math.abs(z.re - z_zero.re) < zpCheckDist && Math.abs(z.im - z_zero.im) < zpCheckDist);
            if (!tooClose) state.zeros.push(z_zero);
        }
    };

    
    const addPole = (re, im) => {
        const poleObject = {re, im}; 

        
        const funcForAnalysis = (zComplex) => {
            const result_re_im = funcOriginal(zComplex.real, zComplex.imag);
            return new Complex(result_re_im.re, result_re_im.im);
        };

        const analysisResult = analyzeSingularity(poleObject, funcForAnalysis, state.currentFunction);

        
        if (analysisResult.re >= xR[0] - zpCheckDist && analysisResult.re <= xR[1] + zpCheckDist &&
            analysisResult.im >= yR[0] - zpCheckDist && analysisResult.im <= yR[1] + zpCheckDist) {
            let tooClose = state.poles.some(p => Math.abs(p.re - analysisResult.re) < zpCheckDist && Math.abs(p.im - analysisResult.im) < zpCheckDist);
            if (!tooClose) {
                state.poles.push(analysisResult);
            }
        }
    };

    
    const searchBounds = { xMin: xR[0], xMax: xR[1], yMin: yR[0], yMax: yR[1] };
    const N_subdivision_points = 30; 

    
    const isChained = state.chainingEnabled && state.chainCount > 1;

    if (!isChained) {
        if (['exp', 'poincare'].includes(state.currentFunction)) {
            state.zeros = []; state.poles = []; return;
        }
        if (state.currentFunction === 'sin') {
            for (let n = Math.ceil(xR[0] / Math.PI) - 1; n <= Math.floor(xR[1] / Math.PI) + 1; n++) addZero(n * Math.PI, 0);
            state.poles = []; return;
        }
        if (state.currentFunction === 'cos') {
            for (let n = Math.ceil(xR[0] / Math.PI - 0.5) - 1; n <= Math.floor(xR[1] / Math.PI - 0.5) + 1; n++) addZero((n + 0.5) * Math.PI, 0);
            state.poles = []; return;
        }
        if (state.currentFunction === 'tan') {
            for (let n = Math.ceil(xR[0] / Math.PI) - 1; n <= Math.floor(xR[1] / Math.PI) + 1; n++) addZero(n * Math.PI, 0);
            for (let n = Math.ceil(xR[0] / Math.PI - 0.5) - 1; n <= Math.floor(xR[1] / Math.PI - 0.5) + 1; n++) addPole((n + 0.5) * Math.PI, 0, 'pole', 1); 
            return;
        }
        if (state.currentFunction === 'sec') { 
            state.zeros = [];
            for (let n = Math.ceil(xR[0] / Math.PI - 0.5) - 1; n <= Math.floor(xR[1] / Math.PI - 0.5) + 1; n++) addPole((n + 0.5) * Math.PI, 0, 'pole', 1); 
            return;
        }
        if (state.currentFunction === 'reciprocal') { 
            addPole(0,0, 'pole', 1); state.zeros = []; return;
        }
         if (state.currentFunction === 'ln') { 
            addZero(1,0); addPole(0,0, 'branch_point'); return;
        }

        
        if (state.currentFunction === 'polynomial') {
            
            
            const coeffsForDK = state.polynomialCoeffs.map(c => c.re).reverse();
            const roots = findPolynomialRoots_DurandKerner(coeffsForDK); 
            roots.forEach(root => addZero(root.real, root.imag));
            state.poles = []; 
            return;
        }

        if (state.currentFunction === 'mobius') {
            
            
            
            
            if (state.mobiusA.re !== 0 || state.mobiusA.im !== 0) {
                const negB = {re: -state.mobiusB.re, im: -state.mobiusB.im};
                const zero_mobius = complexDivide(negB, state.mobiusA); 
                addZero(zero_mobius.re, zero_mobius.im);
            } else if (state.mobiusB.re !== 0 || state.mobiusB.im !== 0) {
                
            }

            if (state.mobiusC.re !== 0 || state.mobiusC.im !== 0) {
                const negD = {re: -state.mobiusD.re, im: -state.mobiusD.im};
                const pole_mobius = complexDivide(negD, state.mobiusC); 
                addPole(pole_mobius.re, pole_mobius.im, 'pole', 1); 
            }
            
            
            return;
        }
    }

    
    
    const generalAnalyticFunctions = ['zeta', 'sin', 'cos', 'tan', 'sec', 'exp', 'ln', 'reciprocal']; 

    
    if (isChained || generalAnalyticFunctions.includes(state.currentFunction)) {

        
        const funcForSubdivision = (zComplex) => {
            const result_re_im = funcOriginal(zComplex.real, zComplex.imag); 
            return new Complex(result_re_im.re, result_re_im.im);
        };

        
        const zerosFound = findGeneralRoots_Subdivision(funcForSubdivision, searchBounds, N_subdivision_points);
        zerosFound.forEach(z => addZero(z.real, z.imag));

        
        const oneOverFunc = (zComplex) => {
            const f_val_complex = funcForSubdivision(zComplex); 
            if (!f_val_complex.isFinite() || (f_val_complex.real === 0 && f_val_complex.imag === 0) ) {
                 
                 
                 
                 
                 
                 
                 
                 
            }
            return (new Complex(1,0)).divide(f_val_complex);
        };

        const polesFound = findGeneralRoots_Subdivision(oneOverFunc, searchBounds, N_subdivision_points);
        polesFound.forEach(p => addPole(p.real, p.imag)); 

        
        if (state.currentFunction === 'zeta') {
            let zetaPoleFound = state.poles.some(p => Math.abs(p.re - ZETA_POLE.re) < zpCheckDist && Math.abs(p.im - ZETA_POLE.im) < zpCheckDist);
            if (!zetaPoleFound && (ZETA_POLE.re >= xR[0] && ZETA_POLE.re <= xR[1] && ZETA_POLE.im >= yR[0] && ZETA_POLE.im <= yR[1])) {
                addPole(ZETA_POLE.re, ZETA_POLE.im, 'pole', 1); 
            }
            if (state.zetaContinuationEnabled) {
                for (let n = -2; n >= Math.floor(xR[0]); n -= 2) { 
                    if (n <= xR[1] && n >= xR[0]) { 
                         let zeroExists = state.zeros.some(z => Math.abs(z.re - n) < zpCheckDist && Math.abs(z.im - 0) < zpCheckDist);
                         if(!zeroExists) addZero(n, 0);
                    }
                }
            }
        }
        
        
        
        
        
        
        
        

        return;
    }


    
    console.warn("Using fallback grid search for:", state.currentFunction); 
    const dx_grid = (xR[1] - xR[0]) / ZERO_POLE_GRID_SIZE;
    const dy_grid = (yR[1] - yR[0]) / ZERO_POLE_GRID_SIZE;

    for (let i = 0; i <= ZERO_POLE_GRID_SIZE; i++) {
        const z_re_eval = xR[0] + i * dx_grid;
        for (let j = 0; j <= ZERO_POLE_GRID_SIZE; j++) {
            const z_im_eval = yR[0] + j * dy_grid;

            const w = funcOriginal(z_re_eval, z_im_eval); 
            if (isNaN(w.re) || isNaN(w.im) || !isFinite(w.re) || !isFinite(w.im)) continue;
            const modW = Math.sqrt(w.re * w.re + w.im * w.im);

            if (modW < ZERO_POLE_EPSILON) addZero(z_re_eval, z_im_eval);
            else if (modW > POLE_MAGNITUDE_THRESHOLD) addPole(z_re_eval, z_im_eval);
        }
    }
} 





export function analyzeSingularity(pole_obj, funcWrapper, funcString) {
    const z0 = new Complex(pole_obj.re, pole_obj.im);
    const MAX_POLE_ORDER_CHECK = 5; 
    const LIMIT_DELTA = 1e-6; 
    const DERIV_H = 1e-4; 
    const FINITE_NON_ZERO_TOLERANCE = 1e-5; 

    let poleOrder = 'unknown';
    let residue = new Complex(NaN, NaN);

    
    for (let k = 1; k <= MAX_POLE_ORDER_CHECK; k++) {
        const h_z = (z) => { 
            const term_z_minus_z0_pow_k = Complex.power(z.subtract(z0), k);
            return term_z_minus_z0_pow_k.multiply(funcWrapper(z));
        };

        
        const p1 = h_z(z0.add(new Complex(LIMIT_DELTA, 0)));
        const p2 = h_z(z0.add(new Complex(-LIMIT_DELTA, 0)));
        const p3 = h_z(z0.add(new Complex(0, LIMIT_DELTA)));
        const p4 = h_z(z0.add(new Complex(0, -LIMIT_DELTA)));

        
        if (p1.isFinite() && p1.equals(p2, FINITE_NON_ZERO_TOLERANCE) &&
            p1.equals(p3, FINITE_NON_ZERO_TOLERANCE) && p1.equals(p4, FINITE_NON_ZERO_TOLERANCE)) {

            if (p1.abs() > FINITE_NON_ZERO_TOLERANCE) { 
                poleOrder = k;
                
                
                
                
                
                
                
                
                break;
            }
        }
    }

    if (poleOrder !== 'unknown' && poleOrder > 0) {
        const m = poleOrder;
        if (m === 1) { 
            
            const h_z_simple = (z) => z.subtract(z0).multiply(funcWrapper(z));
            const r1 = h_z_simple(z0.add(new Complex(LIMIT_DELTA, 0)));
            
            residue = r1;
        } else {
            
            const term_to_differentiate = (z_complex) => {
                const z_minus_z0_pow_m = Complex.power(z_complex.subtract(z0), m);
                return z_minus_z0_pow_m.multiply(funcWrapper(z_complex));
            };

            const derivative_val = numericDerivativeNthOrder(term_to_differentiate, z0, m - 1, DERIV_H);
            if (derivative_val.isFinite()) {
                const fact_m_minus_1 = factorial(m - 1);
                if (fact_m_minus_1 !== 0 && !isNaN(fact_m_minus_1)) {
                    residue = derivative_val.divide(new Complex(fact_m_minus_1, 0));
                }
            }
        }
    } else {
        
        
        
        const f_at_z0 = funcWrapper(z0);
        if (f_at_z0.isFinite()) {
            
            
            poleOrder = 0; 
        } else {
            poleOrder = 'essential';
        }
    }

    
    if (!residue.isFinite() && poleOrder !== 'essential' && poleOrder !== 0) {
        console.warn(`Residue calculation failed for ${funcString} at {${z0.real}, ${z0.imag}}, order ${poleOrder}. Trying contour integral.`);
        
        
        const original_func_re_im = (re, im) => {
            const res_complex = funcWrapper(new Complex(re,im));
            return {re: res_complex.real, im: res_complex.imag};
        };
        const residue_contour_obj = estimateResidue(original_func_re_im, pole_obj, LIMIT_DELTA*10, 360); 
        residue = new Complex(residue_contour_obj.re, residue_contour_obj.im);
    }


    return {
        re: pole_obj.re,
        im: pole_obj.im,
        type: poleOrder === 'essential' ? 'essential' : (poleOrder === 0 ? 'removable' : 'pole'),
        order: poleOrder,
        residue: { re: residue.real, im: residue.imag } 
    };
}
