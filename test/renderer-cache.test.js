import test from 'node:test';
import assert from 'node:assert/strict';

import { state, context, zPlaneParams } from '../js/store/state.js';

class TestPath2D {
    moveTo() {}
    lineTo() {}
}

if (typeof globalThis.Path2D !== 'function') globalThis.Path2D = TestPath2D;

const STATE_KEYS = [
    'currentFunction', 'currentInputShape', 'gridDensity', 'domainColoringEnabled',
    'navigationModeEnabled', 'vectorFieldEnabled', 'streamlineFlowEnabled',
    'manifold3dViewEnabled', 'selectedManifold', 'manifoldTransformationEnabled',
    'riemannSurfaceEnabled', 'foldSurface3dEnabled',
    'taylorSeriesEnabled', 'taylorSeriesCenter', 'taylorSeriesOrder',
    'taylorSeriesConvergenceRadius', 'gridColor1', 'gridColor2',
    'chainingEnabled', 'algebraicChainingEnabled', 'algebraicChainingZExpr',
    'algebraicChainingTerms', 'cauchyIntegralModeEnabled',
    'laplaceModeEnabled', 'conformalGridEnabled', 'dynamicPlotting',
    'a0', 'b0', 'circleR'
];

function makeCanvasContext(kind, counters) {
    const target = {
        canvas: { width: 320, height: 240 },
        setTransform() {},
        clearRect() { if (kind === 'offscreen') counters.clear += 1; },
        drawImage() { if (kind === 'target') counters.targetDraw += 1; },
        save() {}, restore() {}, translate() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
        fill() {}, fillRect() {}, fillText() {}, arc() {}, closePath() {}, rect() {},
        measureText(text) { return { width: String(text).length * 7 }; },
        setLineDash() {}, getLineDash() { return []; }
    };
    return new Proxy(target, {
        get: (object, key) => object[key],
        set: (object, key, value) => {
            object[key] = value;
            return true;
        }
    });
}

test('W planar cache invalidates for Cauchy, algebraic, and Taylor dependencies', async () => {
    const previousState = Object.fromEntries(STATE_KEYS.map(key => [key, state[key]]));
    const previousDocument = globalThis.document;
    const previousImage = globalThis.Image;
    const previousZParams = {
        width: zPlaneParams.width,
        height: zPlaneParams.height,
        origin: zPlaneParams.origin,
        scale: zPlaneParams.scale,
        currentVisXRange: zPlaneParams.currentVisXRange,
        currentVisYRange: zPlaneParams.currentVisYRange
    };
    const contextKeys = [
        'wCanvasList', 'wCtxList', 'wPlaneParamsList', 'wPlaneThreeContainersList',
        'wPlanarTransformedLayerCacheList'
    ];
    const previousContext = Object.fromEntries(contextKeys.map(key => [key, context[key]]));
    const previousAnalysisInfo = context.controls.wPlaneAnalysisInfo;
    const counters = { clear: 0, offscreen: 0, targetDraw: 0 };

    try {
        globalThis.Image = class { set src(value) { this._src = value; } };
        globalThis.document = {
            createElement(tag) {
                if (tag !== 'canvas') return {};
                counters.offscreen += 1;
                const canvas = { width: 0, height: 0 };
                const canvasContext = makeCanvasContext('offscreen', counters);
                canvasContext.canvas = canvas;
                canvas.getContext = () => canvasContext;
                return canvas;
            }
        };
        context.controls.wPlaneAnalysisInfo = { replaceChildren() {}, classList: { toggle() {} } };

        const targetContext = makeCanvasContext('target', counters);
        const wParams = {
            width: 320,
            height: 240,
            origin: { x: 160, y: 120 },
            scale: { x: 20, y: 20 },
            currentVisXRange: [-8, 8],
            currentVisYRange: [-6, 6]
        };
        Object.assign(zPlaneParams, {
            width: 320,
            height: 240,
            origin: { x: 160, y: 120 },
            scale: { x: 20, y: 20 },
            currentVisXRange: [-8, 8],
            currentVisYRange: [-6, 6]
        });
        Object.assign(context, {
            wCanvasList: [{ classList: { toggle() {} } }],
            wCtxList: [targetContext],
            wPlaneParamsList: [wParams],
            wPlaneThreeContainersList: [null],
            wPlanarTransformedLayerCacheList: []
        });
        Object.assign(state, {
            currentFunction: 'cos',
            currentInputShape: 'circle',
            gridDensity: 2,
            domainColoringEnabled: false,
            navigationModeEnabled: false,
            vectorFieldEnabled: false,
            streamlineFlowEnabled: false,
            manifold3dViewEnabled: false,
            selectedManifold: 'sphere',
            manifoldTransformationEnabled: false,
            riemannSurfaceEnabled: false,
            foldSurface3dEnabled: false,
            taylorSeriesEnabled: false,
            chainingEnabled: false,
            cauchyIntegralModeEnabled: false,
            laplaceModeEnabled: false,
            conformalGridEnabled: false,
            dynamicPlotting: { enabled: false },
            a0: 0,
            b0: 0,
            circleR: 1
        });

        const { drawWPlaneContent } = await import('../js/rendering/renderer.js');
        drawWPlaneContent();
        assert.equal(counters.clear, 1);
        assert.equal(context.wPlanarTransformedLayerCacheList[0].canvas.width, 640);
        assert.equal(context.wPlanarTransformedLayerCacheList[0].canvas.height, 480);
        drawWPlaneContent();
        assert.equal(counters.clear, 1, 'unchanged state should hit the layer cache');

        state.cauchyIntegralModeEnabled = true;
        drawWPlaneContent();
        assert.equal(counters.clear, 2);

        Object.assign(state, {
            currentFunction: 'algebraic_chaining',
            algebraicChainingEnabled: true,
            algebraicChainingZExpr: 'z',
            algebraicChainingTerms: [{
                coeff: { re: 1, im: 0 },
                factors: [{
                    func: 'cos', chainedFunc: 'none', power: 1,
                    reciprocal: false, log: false, exp: false
                }]
            }]
        });
        drawWPlaneContent();
        assert.equal(counters.clear, 3);
        state.algebraicChainingEnabled = false;
        drawWPlaneContent();
        assert.equal(counters.clear, 4);

        Object.assign(state, {
            currentFunction: 'cos',
            taylorSeriesEnabled: true,
            taylorSeriesCenter: { re: 0, im: 0 },
            taylorSeriesOrder: 2,
            taylorSeriesConvergenceRadius: 1,
            gridColor1: '#111111',
            gridColor2: '#222222'
        });
        drawWPlaneContent();
        assert.equal(counters.clear, 5);

        state.gridColor2 = '#333333';
        drawWPlaneContent();
        assert.equal(counters.clear, 6);

        state.taylorSeriesConvergenceRadius = 0.5;
        drawWPlaneContent();
        assert.equal(counters.clear, 7);
    } finally {
        Object.assign(state, previousState);
        Object.assign(context, previousContext);
        Object.assign(zPlaneParams, previousZParams);
        if (previousAnalysisInfo === undefined) delete context.controls.wPlaneAnalysisInfo;
        else context.controls.wPlaneAnalysisInfo = previousAnalysisInfo;
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousImage === undefined) delete globalThis.Image;
        else globalThis.Image = previousImage;
    }
});
