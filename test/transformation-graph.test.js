import test from 'node:test';
import assert from 'node:assert/strict';

import { state, zPlaneParams } from '../js/store/state.js';
import {
    buildFullGridTransformationGraphData,
    buildTransformationGraphData
} from '../js/rendering/transformation-graph.js';
import { createPlanarTransformedShapeRenderJob } from '../js/rendering/draw-planar.js';

const STATE_KEYS = [
    'currentFunction', 'currentInputShape', 'gridDensity', 'graphViewEnabled',
    'graphFullGridEnabled', 'graphGridFamily', 'graphFourierEnabled',
    'graphFocusBoxEnabled', 'graphLayerLockEnabled',
    'graphSelectedShape', 'graphSelectedLineIndex', 'graphSelectionRevision',
    'fourierModeEnabled', 'laplaceModeEnabled'
];

test('full-grid perspective selects the expected Cartesian and polar families', () => {
    const previous = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));

    try {
        Object.assign(state, {
            currentFunction: 'sin',
            currentInputShape: 'grid_cartesian',
            gridDensity: 12,
            graphViewEnabled: true,
            graphFullGridEnabled: true,
            graphLayerLockEnabled: false,
            graphGridFamily: 'primary',
            graphFocusBoxEnabled: true,
            graphFourierEnabled: false,
            fourierModeEnabled: false,
            laplaceModeEnabled: false
        });

        const horizontal = buildFullGridTransformationGraphData(zPlaneParams);
        assert.equal(horizontal.mode, 'grid');
        assert.equal(horizontal.curves.length, state.gridDensity + 1);
        assert.ok(horizontal.curves.every(curve => curve.role === 'grid-horizontal'));
        assert.ok(horizontal.curves.every(curve => curve.samples.length >= 128));
        assert.ok(horizontal.curves.every(curve =>
            curve.reScale > 0 && curve.imScale > 0
                && curve.fourierReScale > 0 && curve.fourierImScale > 0
        ));
        assert.ok(horizontal.curves.every(curve => curve.label.startsWith('Im(z) = ')));
        assert.ok(createPlanarTransformedShapeRenderJob(value => value).pointSets
            .every(pointSet => pointSet.role === 'grid-horizontal'));
        const horizontalOffsets = horizontal.curves.map(curve => curve.samples[0].input.im);
        assert.deepEqual(horizontalOffsets, [...horizontalOffsets].sort((left, right) => left - right));
        assert.ok(horizontal.finiteCount > 0);

        state.graphSelectedShape = state.currentInputShape;
        state.graphSelectedLineIndex = horizontal.curves.at(-1).sourceIndex;
        state.graphSelectionRevision += 1;
        const focused = buildFullGridTransformationGraphData(zPlaneParams);
        assert.equal(focused.geometryKey, horizontal.geometryKey);
        assert.equal(focused.selectedCurveIndex, focused.curves.length - 1);

        state.graphGridFamily = 'secondary';
        const vertical = buildFullGridTransformationGraphData(zPlaneParams);
        assert.ok(vertical.curves.every(curve => curve.role === 'grid-vertical'));
        assert.ok(createPlanarTransformedShapeRenderJob(value => value).pointSets
            .every(pointSet => pointSet.role === 'grid-vertical'));

        state.currentInputShape = 'grid_polar';
        state.graphGridFamily = 'primary';
        const circles = buildFullGridTransformationGraphData(zPlaneParams);
        assert.ok(circles.curves.every(curve => curve.role === 'polar-radial'));

        state.graphGridFamily = 'secondary';
        const lines = buildFullGridTransformationGraphData(zPlaneParams);
        assert.ok(lines.curves.every(curve => curve.role === 'polar-angular'));

        state.currentInputShape = 'grid_logcartesian';
        state.graphGridFamily = 'primary';
        const logHorizontal = buildFullGridTransformationGraphData(zPlaneParams);
        assert.ok(logHorizontal.curves.every(curve => curve.role === 'grid-horizontal'));

        state.currentInputShape = 'grid_logpolar';
        const logCircles = buildFullGridTransformationGraphData(zPlaneParams);
        assert.ok(logCircles.curves.every(curve => curve.role === 'logpolar-radial'));
    } finally {
        Object.assign(state, previous);
    }
});

test('locked layers connect the selected grid shape to the opposite family at exact mapped samples', () => {
    const previous = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));

    const assertExactConnections = data => {
        assert.equal(data.mode, 'locked-grid');
        assert.equal(data.lockedCurve, data.curves[0]);
        assert.ok(data.intersections.length > 0);
        assert.ok(data.curves.every(curve =>
            curve.reScale === data.reScale && curve.imScale === data.imScale
        ));
        data.intersections.forEach(intersection => {
            const lockedSample = data.lockedCurve.samples.find(sample =>
                Math.abs(sample.t - intersection.t) <= 1e-8
            );
            const crossingCurve = data.curves.find(curve =>
                curve.sourceIndex === intersection.sourceIndex
            );
            const crossingSample = crossingCurve.samples.find(sample =>
                Math.abs(sample.t - crossingCurve.anchorT) <= 1e-8
            );
            assert.deepEqual(lockedSample.input, crossingSample.input);
            assert.deepEqual(lockedSample.output, crossingSample.output);
            assert.equal(crossingCurve.intersectionT, intersection.t);
        });
    };

    try {
        Object.assign(state, {
            currentFunction: 'sin',
            currentInputShape: 'grid_cartesian',
            gridDensity: 8,
            graphViewEnabled: true,
            graphFullGridEnabled: true,
            graphLayerLockEnabled: true,
            graphGridFamily: 'primary',
            graphSelectedShape: '',
            graphFourierEnabled: false,
            fourierModeEnabled: false,
            laplaceModeEnabled: false
        });

        const horizontal = buildFullGridTransformationGraphData(zPlaneParams);
        assertExactConnections(horizontal);
        assert.equal(horizontal.lockedCurve.role, 'grid-horizontal');
        assert.ok(horizontal.curves.slice(1).every(curve => curve.role === 'grid-vertical'));
        const horizontalInput = createPlanarTransformedShapeRenderJob(value => value).pointSets;
        assert.equal(horizontalInput.filter(set => set.role === 'grid-horizontal').length, 1);
        assert.equal(horizontalInput.filter(set => set.role === 'grid-vertical').length, state.gridDensity + 1);

        state.graphGridFamily = 'secondary';
        state.graphSelectedShape = '';
        const vertical = buildFullGridTransformationGraphData(zPlaneParams);
        assertExactConnections(vertical);
        assert.equal(vertical.lockedCurve.role, 'grid-vertical');
        assert.ok(vertical.curves.slice(1).every(curve => curve.role === 'grid-horizontal'));

        state.currentFunction = 'exp';
        state.graphSelectedShape = '';
        const exponentialAxis = buildFullGridTransformationGraphData(zPlaneParams);
        const radii = exponentialAxis.lockedCurve.samples
            .filter(sample => Number.isFinite(sample.output.re) && Number.isFinite(sample.output.im))
            .map(sample => Math.hypot(sample.output.re, sample.output.im));
        assert.ok(Math.abs(exponentialAxis.lockedCurve.samples[0].input.re) <= 1e-12);
        assert.ok(Math.max(...radii) - Math.min(...radii) <= 1e-12);
        assert.ok(Math.abs(exponentialAxis.reScale - 1) <= 1e-12);
        assert.ok(Math.abs(exponentialAxis.imScale - 1) <= 2e-5);

        state.currentFunction = 'sin';
        state.currentInputShape = 'grid_polar';
        state.graphGridFamily = 'primary';
        state.graphSelectedShape = '';
        const circle = buildFullGridTransformationGraphData(zPlaneParams);
        assertExactConnections(circle);
        assert.equal(circle.lockedCurve.role, 'polar-radial');
        assert.ok(circle.curves.slice(1).every(curve => curve.role === 'polar-angular'));

        state.graphGridFamily = 'secondary';
        state.graphSelectedShape = '';
        const radialLine = buildFullGridTransformationGraphData(zPlaneParams);
        assertExactConnections(radialLine);
        assert.equal(radialLine.lockedCurve.role, 'polar-angular');
        assert.ok(radialLine.curves.slice(1).every(curve => curve.role === 'polar-radial'));
    } finally {
        Object.assign(state, previous);
    }
});

test('standalone Fourier mode never produces transformation-graph data', () => {
    const previous = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));

    try {
        Object.assign(state, {
            currentFunction: 'fourier',
            currentInputShape: 'grid_cartesian',
            graphViewEnabled: true,
            graphFullGridEnabled: false,
            graphLayerLockEnabled: false,
            graphFourierEnabled: false,
            fourierModeEnabled: true,
            laplaceModeEnabled: false
        });

        assert.equal(buildTransformationGraphData(zPlaneParams), null);
    } finally {
        Object.assign(state, previous);
    }
});

test('full-grid samples follow the live z-plane zoom while preserving the selected family', () => {
    const previous = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));
    const previousXRange = [...zPlaneParams.currentVisXRange];
    const previousYRange = [...zPlaneParams.currentVisYRange];

    try {
        Object.assign(state, {
            currentFunction: 'sin',
            currentInputShape: 'grid_cartesian',
            gridDensity: 6,
            graphViewEnabled: true,
            graphFullGridEnabled: true,
            graphLayerLockEnabled: false,
            graphGridFamily: 'primary',
            graphFourierEnabled: false,
            fourierModeEnabled: false,
            laplaceModeEnabled: false
        });
        zPlaneParams.currentVisXRange = [-4, 4];
        zPlaneParams.currentVisYRange = [-3, 3];
        const wide = buildFullGridTransformationGraphData(zPlaneParams);

        zPlaneParams.currentVisXRange = [-1.5, 1.5];
        zPlaneParams.currentVisYRange = [-1, 1];
        const zoomed = buildFullGridTransformationGraphData(zPlaneParams);

        assert.notEqual(zoomed.key, wide.key);
        assert.equal(zoomed.curves.length, wide.curves.length);
        assert.equal(zoomed.curves[0].samples[0].input.re, -1.5);
        assert.equal(zoomed.curves[0].samples.at(-1).input.re, 1.5);
    } finally {
        zPlaneParams.currentVisXRange = previousXRange;
        zPlaneParams.currentVisYRange = previousYRange;
        Object.assign(state, previous);
    }
});
