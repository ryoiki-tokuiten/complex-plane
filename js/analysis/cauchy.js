import { state, context } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import {
    getChainedTransformFunction,
    getContourPoints,
    numericalLineIntegral,
    isPointInsideContour,
    estimateResidue,
    complexAdd,
    complexMul,
    buildMappedTransformProfileKey
} from '../math-utils.js';
import {
    NUM_INTEGRAL_STEPS,
    RESIDUE_CALC_EPSILON_RADIUS,
    RESIDUE_BOUNDARY_CHECK_FACTOR,
    NUM_RESIDUE_INTEGRAL_STEPS
} from '../constants/numerical.js';
import { createSafeMarkupFragment } from '../ui/dom-components.js';

const { controls } = context;

const cauchyDisplayCache = {
    element: null,
    key: null,
    hidden: null
};
let cauchyAnalysisCache = null;

function complexListKey(values) {
    return Array.isArray(values)
        ? values.map(value => [value?.re, value?.im, value?.type, value?.order, value?.residue?.re, value?.residue?.im].join(':')).join(';')
        : '';
}

function cauchyAnalysisKey(isZPlanar) {
    return [
        isZPlanar ? 1 : 0,
        buildMappedTransformProfileKey(state.currentFunction),
        state.chainingEnabled ? 1 : 0,
        state.chainingMode,
        state.chainCount,
        state.taylorSeriesEnabled ? 1 : 0,
        state.taylorSeriesOrder,
        state.taylorSeriesCenter?.re,
        state.taylorSeriesCenter?.im,
        state.currentInputShape,
        state.a0,
        state.b0,
        state.circleR,
        state.ellipseA,
        state.ellipseB,
        state.showZerosPoles ? 1 : 0,
        complexListKey(state.poles)
    ].join('|');
}

function publishCauchyResult(key, { text = null, html = null, hidden = false } = {}) {
    const element = controls.cauchy_integral_results_info;
    if (!element) return;

    const elementChanged = cauchyDisplayCache.element !== element;
    const visibilityChanged = elementChanged || cauchyDisplayCache.hidden !== hidden;
    const outputChanged = elementChanged || cauchyDisplayCache.key !== key;

    if (visibilityChanged) element.classList.toggle('hidden', hidden);
    if (!outputChanged) return;

    if (hidden) {
        element.replaceChildren();
    } else if (html !== null) {
        element.replaceChildren(createSafeMarkupFragment(html));
    } else {
        element.textContent = text || '';
    }

    cauchyDisplayCache.element = element;
    cauchyDisplayCache.key = key;
    cauchyDisplayCache.hidden = hidden;
}

export function performCauchyAnalysis() {
    if (!controls.cauchy_integral_results_info) return;
    const isZPlanar = !state.riemannSphereViewEnabled || state.splitViewEnabled;
    const analysisKey = cauchyAnalysisKey(isZPlanar);
    const active = state.cauchyIntegralModeEnabled && isZPlanar;
    const cacheInputKey = `${analysisKey}|active:${active ? 1 : 0}`;
    if (cauchyAnalysisCache?.inputKey === cacheInputKey) {
        publishCauchyResult(cauchyAnalysisCache.outputKey, cauchyAnalysisCache.result);
        return;
    }

    const publish = (outputKey, result) => {
        cauchyAnalysisCache = { inputKey: cacheInputKey, outputKey, result };
        publishCauchyResult(outputKey, result);
    };

    if (!active) {
        publish(`${analysisKey}|hidden`, { hidden: true });
        return;
    }

    const func = getChainedTransformFunction(state.currentFunction);
    if (!func) {
        publish(`${analysisKey}|missing-function`, { text: 'Error: Current function not found.' });
        return;
    }
    if (state.currentFunction === 'poincare') { 
        publish(`${analysisKey}|poincare`, { text: 'Cauchy/Residue analysis not applicable for Poincare map.' });
        return;
    }


    let contourC_points = null;
    let contourParams = {};

    if (state.currentInputShape === 'circle') {
        if (state.circleR <= 0) {
            publish(`${analysisKey}|invalid-circle-radius`, { text: 'Cauchy mode: Circle radius must be positive.' });
            return;
        }
        contourParams = { type: 'circle', cx: state.a0, cy: state.b0, r: state.circleR };
        contourC_points = getContourPoints('circle', contourParams, NUM_INTEGRAL_STEPS);
    } else if (state.currentInputShape === 'ellipse') {
        if (state.ellipseA <= 0 || state.ellipseB <= 0) {
            publish(`${analysisKey}|invalid-ellipse-axes`, { text: 'Cauchy mode: Ellipse axes must be positive.' });
            return;
        }
        contourParams = { type: 'ellipse', cx: state.a0, cy: state.b0, a: state.ellipseA, b: state.ellipseB };
        contourC_points = getContourPoints('ellipse', contourParams, NUM_INTEGRAL_STEPS);
    } else {
        publish(`${analysisKey}|unsupported-shape`, { text: 'Cauchy mode: Select Circle or Ellipse contour C.' });
        return;
    }

    if (!contourC_points || contourC_points.length === 0) {
        publish(`${analysisKey}|empty-contour`, { text: 'Error generating contour points for C.' });
        return;
    }

    const integralValue = numericalLineIntegral(func, contourC_points);
    let resultsHTML = `∮<sub>C</sub> f(z)dz ≈ `;
    if (isNaN(integralValue.re) || isNaN(integralValue.im)) {
        resultsHTML += `N/A (Pole likely on contour)`;
    } else {
        resultsHTML += `${integralValue.re.toFixed(3)} + ${integralValue.im.toFixed(3)}i`;
    }


    if (state.showZerosPoles && state.poles) {
        let polesInsideC = [];
        let polesTooCloseToContourForResidue = false;

        state.poles.forEach(pole => {
            if (isPointInsideContour(pole, contourParams.type, contourParams)) {
                
                let safeToCalcResidue = true;
                const distToCenterSq = (pole.re - contourParams.cx)**2 + (pole.im - contourParams.cy)**2;

                if (contourParams.type === 'circle') {
                    if (Math.sqrt(distToCenterSq) >= contourParams.r - RESIDUE_CALC_EPSILON_RADIUS * RESIDUE_BOUNDARY_CHECK_FACTOR) {
                        safeToCalcResidue = false;
                    }
                } else { 
                    const dx = pole.re - contourParams.cx;
                    const dy = pole.im - contourParams.cy;
                    const effectiveEpsilon = RESIDUE_CALC_EPSILON_RADIUS * RESIDUE_BOUNDARY_CHECK_FACTOR / Math.min(contourParams.a, contourParams.b);
                    if ((dx / contourParams.a)**2 + (dy / contourParams.b)**2 >= (1 - effectiveEpsilon)**2 ) {
                         safeToCalcResidue = false;
                    }
                }

                if (safeToCalcResidue) {
                    polesInsideC.push(pole);
                } else {
                    polesTooCloseToContourForResidue = true;
                }
            }
        });

        if (polesInsideC.length > 0) {
            let sumResidues = { re: 0, im: 0 };
            let hasEssentialSingularityInside = false;
            resultsHTML += `<br/>Singularities inside C: ${polesInsideC.length}`;

            polesInsideC.forEach(pole => {
                let displayResidue = { re: NaN, im: NaN };
                let residueSource = ""; 

                if (pole.type === 'essential') {
                    hasEssentialSingularityInside = true;
                    resultsHTML += `<br/>&nbsp;&nbsp;Essential singularity at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i`;
                    
                } else if (pole.type === 'pole') {
                    let poleOrderDisplay = pole.order !== 'unknown' && pole.order !== null ? `(order: ${pole.order})` : '';
                    resultsHTML += `<br/>&nbsp;&nbsp;Pole at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i ${poleOrderDisplay}`;

                    if (pole.residue && typeof pole.residue.re === 'number' && typeof pole.residue.im === 'number' &&
                        isFinite(pole.residue.re) && isFinite(pole.residue.im)) {
                        displayResidue = pole.residue;
                        residueSource = "pre-calc";
                    } else {
                        
                        const estimatedRes = estimateResidue(func, pole, RESIDUE_CALC_EPSILON_RADIUS, NUM_RESIDUE_INTEGRAL_STEPS);
                        if (typeof estimatedRes.re === 'number' && typeof estimatedRes.im === 'number' &&
                            isFinite(estimatedRes.re) && isFinite(estimatedRes.im)) {
                            displayResidue = estimatedRes;
                            residueSource = "estimated";
                        }
                    }

                    if (!isNaN(displayResidue.re) && !isNaN(displayResidue.im)) {
                        sumResidues = complexAdd(sumResidues, displayResidue);
                        resultsHTML += ` &nbsp;&nbsp;Res ≈ ${displayResidue.re.toFixed(2)} + ${displayResidue.im.toFixed(2)}i`;
                        if (residueSource === "estimated") resultsHTML += ` (est.)`;
                    } else {
                        resultsHTML += ` &nbsp;&nbsp;Res ≈ N/A (calc failed)`;
                    }
                } else if (pole.type === 'branch_point') { 
                     resultsHTML += `<br/>&nbsp;&nbsp;Branch point at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i (Residue theorem may not directly apply or needs careful branch cut handling).`;
                     hasEssentialSingularityInside = true; 
                } else {
                    
                     resultsHTML += `<br/>&nbsp;&nbsp;Singularity at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i (type: ${pole.type || 'unknown'})`;
                }
            });

            if (!hasEssentialSingularityInside) {
                const twoPiI = { re: 0, im: 2 * Math.PI };
                const residueTheoremSum = complexMul(twoPiI, sumResidues);
                resultsHTML += `<br/>2πi ΣRes ≈ ${residueTheoremSum.re.toFixed(3)} + ${residueTheoremSum.im.toFixed(3)}i`;
            } else {
                resultsHTML += `<br/>2πi ΣRes: N/A (Presence of essential singularity or branch point; theorem requires careful application).`;
            }
            if (polesTooCloseToContourForResidue) {
                resultsHTML += ` (Some singularities inside C are too close to contour for individual residue calc).`;
            }
        } else {
            resultsHTML += `<br/>No singularities found sufficiently inside C for residue calculation.`;
            if (polesTooCloseToContourForResidue || state.poles.some(p => isPointInsideContour(p, contourParams.type, contourParams))) {
                 resultsHTML += ` (Some poles may be too close to contour or on it).`;
            }
        }
    } else if (state.showZerosPoles) {
         resultsHTML += `<br/>No poles identified in view.`;
    } else {
        resultsHTML += `<br/>(Enable 'Show Zeros/Poles' for Residue Theorem)`;
    }

    publish(analysisKey, { html: resultsHTML });
}

export function updateWindingNumberDisplay(tf) {
    controls.wPlaneAnalysisInfo.replaceChildren();
    let contourC_points = null;
    let contourParams = {};
    const N_winding_num_pts = 150; 
    let canCalculateWinding = false;
    const wIsPlanar = !(state.riemannSphereViewEnabled || state.splitViewEnabled);

    if (wIsPlanar && state.cauchyIntegralModeEnabled && (state.currentInputShape === 'circle' || state.currentInputShape === 'ellipse')) {
        canCalculateWinding = true;
        if (state.currentInputShape === 'circle') {
            contourParams = { type: 'circle', cx: state.a0, cy: state.b0, r: state.circleR };
            if (state.circleR <= 0) canCalculateWinding = false;
        } else {
            contourParams = { type: 'ellipse', cx: state.a0, cy: state.b0, a: state.ellipseA, b: state.ellipseB };
            if (state.ellipseA <= 0 || state.ellipseB <= 0) canCalculateWinding = false;
        }
    } else if (wIsPlanar && !state.cauchyIntegralModeEnabled && state.currentFunction === 'polynomial' && state.currentInputShape === 'circle') {
        canCalculateWinding = true;
        contourParams = { type: 'circle', cx: state.a0, cy: state.b0, r: state.circleR };
        if (state.circleR <= 0) canCalculateWinding = false;
    }
    
    if (canCalculateWinding) {contourC_points = getContourPoints(contourParams.type, contourParams, N_winding_num_pts);}
    if (contourC_points && contourC_points.length > 1) {
        let totalAngleChange = 0;let prev_w_arg = null;let pathCrossesOrigin = false;let pathHasNaN = false;
        for (let i = 0; i < contourC_points.length; i++) { 
            const z_on_C = contourC_points[i];const w = tf(z_on_C.re, z_on_C.im);
            if (isNaN(w.re) || isNaN(w.im) || !isFinite(w.re) || !isFinite(w.im)) {prev_w_arg = null; pathHasNaN = true; break; }
            if (Math.abs(w.re) < 1e-9 && Math.abs(w.im) < 1e-9) { pathCrossesOrigin = true; break; }
            const current_w_arg = Math.atan2(w.im, w.re);
            if (prev_w_arg !== null) {
                let angleDiff = current_w_arg - prev_w_arg;
                if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
                if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
                totalAngleChange += angleDiff;
            }
            prev_w_arg = current_w_arg;
        }
        let windingNumber;
        if (pathCrossesOrigin) {windingNumber = "N/A (f(C) intersects w=0)";} 
        else if (pathHasNaN) {windingNumber = "N/A (f(z) undefined on C)";} 
        else {windingNumber = Math.round(totalAngleChange / (2 * Math.PI));}
        
        let Z_in_C = 0, P_in_C = 0;let argumentPrincipleText = "";
        if (state.cauchyIntegralModeEnabled && state.showZerosPoles && state.zeros && state.poles && !pathCrossesOrigin && !pathHasNaN && typeof windingNumber === 'number') {
            state.zeros.forEach(zero => {if (isPointInsideContour(zero, contourParams.type, contourParams)) Z_in_C++;});
            state.poles.forEach(pole => {if (isPointInsideContour(pole, contourParams.type, contourParams)) P_in_C++;});
            argumentPrincipleText = ` (Z-P in C = ${Z_in_C}-${P_in_C} = ${Z_in_C - P_in_C})`;
        }
        controls.wPlaneAnalysisInfo.textContent = `W(f(C),0): ${windingNumber}${argumentPrincipleText}`;
        const windingChanged = !pathCrossesOrigin && !pathHasNaN &&
            typeof windingNumber === 'number' &&
            runtime.rendering.previousWindingNumber !== null &&
            windingNumber !== runtime.rendering.previousWindingNumber;
        if (windingChanged) runtime.rendering.wOriginGlowTime = Date.now();
        runtime.rendering.previousWindingNumber = (typeof windingNumber === 'number') ? windingNumber : null;
    } else {
        controls.wPlaneAnalysisInfo.replaceChildren();
        runtime.rendering.previousWindingNumber = null;
    }
}
