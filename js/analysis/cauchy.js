import { state, context } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { buildMappedTransformProfileKey } from '../native/map-runtime.js';
import {
    analyzeNativeContour,
    classifyNativeContourSingularities,
    generateNativeContourPoints,
    nativeMapOptions
} from '../native/complex-engine.js';
import {
    NUM_INTEGRAL_STEPS,
    RESIDUE_CALC_EPSILON_RADIUS,
    RESIDUE_BOUNDARY_CHECK_FACTOR
} from '../constants/numerical.js';
import { createSafeMarkupFragment } from '../ui/dom-components.js';
import { buildInputShapeGeometryConfig, generateInputShapePointSets } from '../rendering/shape-generators.js';

const { controls } = context;

const cauchyDisplayCache = {
    element: null,
    key: null,
    hidden: null
};
let cauchyAnalysisCache = null;

export function isPointInsideContour(point, contourType, params) {
    if (!point || !params) throw new Error('Contour classification requires a point and parameters.');
    let polygonContours = [];
    if (contourType === 'contours') {
        if (!Array.isArray(params.contours)) throw new Error('Contour collections require a contours array.');
        polygonContours = params.contours;
    } else if (contourType === 'contour') {
        if (!Array.isArray(params.points)) throw new Error('Polygon contours require a points array.');
        polygonContours = [params.points];
    }
    const results = classifyNativeContourSingularities(contourType, params, polygonContours, 0, [point]);
    if (!results[0]) throw new Error('Native contour classification returned no result.');
    return results[0].inside;
}

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
        state.chainSeed?.re,
        state.chainSeed?.im,
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
        state.arbitraryShapeMode,
        state.arbitraryShapeExpression,
        state.arbitraryShapeTMin,
        state.arbitraryShapeTMax,
        complexListKey(state.arbitraryShapePoints),
        state.arbitraryShapeClosed ? 1 : 0,
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

export function resolveCauchyContour(state, { planeParams = null, curvePoints = NUM_INTEGRAL_STEPS } = {}) {
    const shape = state.currentInputShape;
    if (shape === 'circle') {
        if (state.circleR <= 0) return { valid: false, error: 'invalid-circle-radius', message: 'Cauchy mode: Circle radius must be positive.' };
        const params = { cx: state.a0, cy: state.b0, r: state.circleR };
        return {
            type: 'circle',
            params,
            pointSets: curvePoints ? [generateNativeContourPoints('circle', { type: 'circle', ...params }, curvePoints)] : null,
            valid: true
        };
    }
    if (shape === 'ellipse') {
        if (state.ellipseA <= 0 || state.ellipseB <= 0) return { valid: false, error: 'invalid-ellipse-axes', message: 'Cauchy mode: Ellipse axes must be positive.' };
        const params = { cx: state.a0, cy: state.b0, a: state.ellipseA, b: state.ellipseB };
        return {
            type: 'ellipse',
            params,
            pointSets: curvePoints ? [generateNativeContourPoints('ellipse', { type: 'ellipse', ...params }, curvePoints)] : null,
            valid: true
        };
    }
    if (shape === 'arbitrary') {
        if (!state.arbitraryShapeClosed) return { valid: false, error: 'open-arbitrary-shape', message: 'Cauchy mode: Close the arbitrary shape before integrating.' };
        const contours = generateInputShapePointSets(buildInputShapeGeometryConfig(planeParams, {
            currentInputShape: 'arbitrary',
            ...(curvePoints ? { curvePoints } : {})
        })).map(pointSet => pointSet.points).filter(points => points.length >= 4);
        if (!contours.length || contours.some(points => points.some(point => !Number.isFinite(point?.re) || !Number.isFinite(point?.im)))) {
            return { valid: false, error: 'invalid-arbitrary-shape', message: 'Cauchy mode: Draw or enter finite closed shapes C.' };
        }
        return {
            type: 'contours',
            params: { contours },
            pointSets: contours,
            valid: true
        };
    }
    return { valid: false, error: 'unsupported-shape', message: 'Cauchy mode: Select Circle, Ellipse, or Arbitrary Shape.' };
}

export function performCauchyAnalysis() {
    if (!controls.cauchy_integral_results_info) return;
    const isZPlanar = !(state.manifold3dViewEnabled && state.manifoldTransformationEnabled);
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

    const resolved = resolveCauchyContour(state, { curvePoints: NUM_INTEGRAL_STEPS });
    if (!resolved.valid) {
        publish(`${analysisKey}|${resolved.error}`, { text: resolved.message });
        return;
    }

    const map = nativeMapOptions(state);
    const contourCPointSets = resolved.pointSets;
    const contourC_points = contourCPointSets[0] || [];
    const contourParams = resolved.type === 'contours'
        ? { type: 'contours', contours: resolved.pointSets }
        : { type: resolved.type, ...resolved.params };

    if (!contourC_points || contourC_points.length === 0) {
        publish(`${analysisKey}|empty-contour`, { text: 'Error generating contour points for C.' });
        return;
    }

    const integralValue = (contourCPointSets || [contourC_points]).reduce((sum, points) => {
        const value = analyzeNativeContour(map, points).integral;
        return { re: sum.re + value.re, im: sum.im + value.im };
    }, { re: 0, im: 0 });
    let resultsHTML = `∮<sub>C</sub> f(z)dz ≈ `;
    if (isNaN(integralValue.re) || isNaN(integralValue.im)) {
        resultsHTML += `N/A (Pole likely on contour)`;
    } else {
        resultsHTML += `${integralValue.re.toFixed(3)} + ${integralValue.im.toFixed(3)}i`;
    }


    if (state.showZerosPoles && Array.isArray(state.poles) && state.poles.length > 0) {
        let polesInsideC = [];
        let polesTooCloseToContourForResidue = false;

        const epsilon = RESIDUE_CALC_EPSILON_RADIUS * RESIDUE_BOUNDARY_CHECK_FACTOR;
        const classifications = classifyNativeContourSingularities(
            contourParams.type,
            contourParams,
            contourCPointSets || [contourC_points],
            epsilon,
            state.poles
        );

        classifications.forEach((classification, index) => {
            const pole = state.poles[index];
            if (classification.inside) {
                if (classification.safeForResidue) {
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

                if (pole.type === 'essential') {
                    hasEssentialSingularityInside = true;
                    resultsHTML += `<br/>&nbsp;&nbsp;Essential singularity at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i`;
                    
                } else if (pole.type === 'pole') {
                    let poleOrderDisplay = pole.order !== 'unknown' && pole.order !== null ? `(order: ${pole.order})` : '';
                    resultsHTML += `<br/>&nbsp;&nbsp;Pole at z = ${pole.re.toFixed(2)} + ${pole.im.toFixed(2)}i ${poleOrderDisplay}`;

                    if (!pole.residue || !Number.isFinite(pole.residue.re) ||
                        !Number.isFinite(pole.residue.im)) {
                        throw new Error('Cauchy analysis requires precomputed native residues for every pole.');
                    }
                    displayResidue = pole.residue;

                    if (!isNaN(displayResidue.re) && !isNaN(displayResidue.im)) {
                        sumResidues = { re: sumResidues.re + displayResidue.re, im: sumResidues.im + displayResidue.im };
                        resultsHTML += ` &nbsp;&nbsp;Res ≈ ${displayResidue.re.toFixed(2)} + ${displayResidue.im.toFixed(2)}i`;
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
                const residueTheoremSum = { re: -2 * Math.PI * sumResidues.im, im: 2 * Math.PI * sumResidues.re };
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

export function updateWindingNumberDisplay() {
    controls.wPlaneAnalysisInfo.replaceChildren();
    let contourC_points = null;
    const N_winding_num_pts = 150;
    const wIsPlanar = !state.manifold3dViewEnabled;

    if (wIsPlanar && (state.cauchyIntegralModeEnabled || (state.currentFunction === 'polynomial' && state.currentInputShape === 'circle'))) {
        const resolved = resolveCauchyContour(state, { curvePoints: N_winding_num_pts });
        if (resolved.valid) {
            contourC_points = resolved.type === 'contours'
                ? resolved.pointSets.flatMap((points, index) => index ? [null, ...points] : points)
                : resolved.pointSets[0];
        }
    }

    if (contourC_points && contourC_points.length > 1) {
        const analysis = analyzeNativeContour(nativeMapOptions(state), contourC_points);
        const pathHasNaN = !!(analysis.status & 1);
        const pathCrossesOrigin = !!(analysis.status & 2);
        let windingNumber;
        if (pathCrossesOrigin) {windingNumber = "N/A (f(C) intersects w=0)";} 
        else if (pathHasNaN) {windingNumber = "N/A (f(z) undefined on C)";} 
        else {windingNumber = Math.round(analysis.winding);}
        
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
