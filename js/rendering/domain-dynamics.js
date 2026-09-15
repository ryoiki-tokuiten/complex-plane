import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import { runtime } from '../store/runtime.js';
import { generateDiscreteSource } from '../analysis/discrete-sources.js';
import { generateSequenceBindingSeries, synchronizeSequenceBindings } from '../analysis/sequence-bindings.js';
import { computeTaylorSeriesCoefficients } from '../native/map-runtime.js';
import { compileNativeDynamicAggregate } from '../native/complex-engine.js';
import { DomainCoordinator } from './domain-coordinator.js';
import { context } from '../store/state.js';
import {
    normalizeOrbitColoringMode
} from '../constants/rendering.js';
import { normalizeDomainDynamicsChainCount } from '../constants/domain-dynamics.js';
import { preciseViewportSnapshot } from '../native/precise-viewport.js';
import {
    requireFiniteComplex,
    requireFiniteNumber,
    requireInteger
} from '../utils/numeric-contracts.js';
import { clonePlain } from '../utils/clone-utils.js';
import { signal } from '@preact/signals';

const SUPPORTED_FUNCTIONS = new Set([
    'sin',
    'cos',
    'tan',
    'sec',
    'exp',
    'ln',
    'sinh',
    'tanh',
    'asin',
    'atan',
    'gamma',
    'loggamma',
    'bessel',
    'power',
    'mobius',
    'zeta',
    'polynomial',
    'algebraic_chaining'
]);

let coordinator = null;
let activeSignature = null;

function paletteStops(paletteId) {
    const stops = getDomainPaletteStops(paletteId);
    if (stops.length < 2) throw new Error(`Domain palette ${paletteId} has fewer than two stops.`);
    return stops;
}

function domainViewportSnapshot(planeParams, width, height) {
    return { ...preciseViewportSnapshot(planeParams), width, height };
}

function normalizeChainMode(mode) {
    if (mode !== 'zero_seed' && mode !== 'recursion') {
        throw new Error(`Unsupported domain-dynamics chain mode: ${mode}`);
    }
    return mode;
}

function dynamicAggregateSnapshot(runtimeState) {
    const config = runtimeState?.dynamicPlotting;
    const reductionKind = config?.reduction?.kind;
    if (!config?.enabled || config.mode !== 'aggregate' ||
        (reductionKind !== 'sum' && reductionKind !== 'product')) return null;

    if (!config.source || !config.term || !config.playback || typeof config.pointExpression !== 'string') {
        throw new Error('Domain dynamics requires complete dynamic aggregate configuration.');
    }
    if (config.reduction.invalidPolicy !== 'stop' && config.reduction.invalidPolicy !== 'skip') {
        throw new Error(`Unsupported dynamic invalid policy: ${config.reduction.invalidPolicy}.`);
    }
    const source = generateDiscreteSource(clonePlain(config.source));

    const requestedVisibleCount = Number(config.playback?.visibleCount);
    if (!Number.isFinite(requestedVisibleCount)) {
        throw new Error('Domain dynamics requires a finite dynamic visible count.');
    }
    const visibleCount = Math.max(0, Math.min(source.records.length, Math.floor(requestedVisibleCount)));

    if (config.term.kind !== 'expression' && config.term.kind !== 'selected-function') {
        throw new Error(`Unsupported dynamic term kind: ${config.term.kind}.`);
    }
    const termExpression = config.term.kind === 'expression' ? config.term.expression : 'selected(z)';
    if (typeof termExpression !== 'string' || !Array.isArray(config.term.bindings)) {
        throw new Error('Domain dynamics requires explicit dynamic term bindings.');
    }
    const bindings = synchronizeSequenceBindings(termExpression, config.term.bindings);

    const bindingResult = generateSequenceBindingSeries(bindings, visibleCount, {
        aggregateParameter: { re: 0, im: 0 }
    });
    return compileNativeDynamicAggregate({
        pointExpression: config.pointExpression,
        term: clonePlain(config.term),
        bindings: clonePlain(bindings),
        reductionKind,
        invalidPolicy: config.reduction.invalidPolicy,
        sourceRecords: source.records.slice(0, visibleCount).map(record => ({
            ordinal: record.ordinal,
            domainValue: clonePlain(record.domainValue)
        })),
        bindingSeries: clonePlain(bindingResult.series)
    });
}

function taylorSnapshot(runtimeState, functionKey) {
    if (!runtimeState?.taylorSeriesEnabled) return null;

    const center = clonePlain(runtimeState.taylorSeriesCenter);
    const order = requireInteger(runtimeState.taylorSeriesOrder, 'Taylor order');
    if (order < 0) throw new Error('Taylor order must be non-negative.');
    const coefficients = computeTaylorSeriesCoefficients(functionKey, center, order);
    if (!Array.isArray(coefficients) || coefficients.length < order + 1) {
        throw new Error('Native Taylor coefficient generation returned incomplete data.');
    }
    const radius = Number(runtimeState.taylorSeriesConvergenceRadius);
    if ((!Number.isFinite(radius) && radius !== Infinity) || radius < 0) {
        throw new Error('Taylor convergence radius must be non-negative or infinite.');
    }

    return {
        center,
        order,
        radius,
        coefficients: clonePlain(coefficients)
    };
}

export function buildPlanarDomainDynamicsSnapshot(runtimeState, planeParams, options = null) {
    if (!runtimeState || !planeParams) throw new Error('Domain dynamics requires state and plane parameters.');
    const width = requireInteger(planeParams.width, 'Domain-dynamics viewport width');
    const height = requireInteger(planeParams.height, 'Domain-dynamics viewport height');
    if (width < 1 || height < 1) {
        throw new Error('Domain dynamics requires positive integer viewport dimensions.');
    }

    const functionKey = runtimeState.currentFunction;
    if (!SUPPORTED_FUNCTIONS.has(functionKey)) {
        throw new Error(`Unsupported native domain-dynamics function: ${functionKey}`);
    }
    const orbitColoringMode = normalizeOrbitColoringMode(runtimeState.orbitColoringMode);

    const polynomialN = requireInteger(runtimeState.polynomialN, 'Domain dynamics polynomial degree');
    if (polynomialN < 0) throw new Error('Domain dynamics polynomial degree must be non-negative.');
    const fractionalPowerN = requireFiniteNumber(runtimeState.fractionalPowerN, 'Domain dynamics fractional power');
    const branchCutAngle = requireFiniteNumber(runtimeState.branchCutAngle, 'Domain dynamics branch-cut angle');
    const mapPresentation = options?.mapPresentation ?? runtimeState.mapPresentation;
    if (mapPresentation !== 'function' && mapPresentation !== 'derivative') {
        throw new Error(`Unsupported domain-dynamics map presentation: ${mapPresentation}.`);
    }
    for (const [name, value] of [
        ['chainingEnabled', runtimeState.chainingEnabled],
        ['algebraicChainingEnabled', runtimeState.algebraicChainingEnabled],
        ['zetaContinuationEnabled', runtimeState.zetaContinuationEnabled]
    ]) {
        if (typeof value !== 'boolean') throw new Error(`Domain dynamics ${name} must be boolean.`);
    }
    const snapshot = {
        derivativeOrder: mapPresentation === 'derivative' ? 1 : 0,
        functionKey,
        expBase: clonePlain(runtimeState.expBase),
        logBase: clonePlain(runtimeState.logBase),
        besselOrder: clonePlain(runtimeState.besselOrder),
        chainingEnabled: runtimeState.chainingEnabled,
        chainMode: normalizeChainMode(runtimeState.chainingMode),
        chainSeed: clonePlain(requireFiniteComplex(runtimeState.chainSeed ?? { re: 0, im: 0 }, 'Domain-dynamics chain seed')),
        chainCount: normalizeDomainDynamicsChainCount(runtimeState.chainCount),
        orbitColoringMode,
        algebraicChainingEnabled: runtimeState.algebraicChainingEnabled,
        algebraicChainingTerms: clonePlain(runtimeState.algebraicChainingTerms),
        algebraicChainingZExpr: clonePlain(runtimeState.algebraicChainingZExpr),
        mobiusA: clonePlain(runtimeState.mobiusA),
        mobiusB: clonePlain(runtimeState.mobiusB),
        mobiusC: clonePlain(runtimeState.mobiusC),
        mobiusD: clonePlain(runtimeState.mobiusD),
        polynomialN,
        polynomialCoeffs: clonePlain(runtimeState.polynomialCoeffs),
        fractionalPowerN,
        branchCutAngle,
        zetaContinuationEnabled: runtimeState.zetaContinuationEnabled,
        taylor: taylorSnapshot(runtimeState, functionKey),
        dynamicAggregate: dynamicAggregateSnapshot(runtimeState),
        style: {
            brightness: requireFiniteNumber(runtimeState.domainBrightness, 'Domain brightness'),
            contrast: requireFiniteNumber(runtimeState.domainContrast, 'Domain contrast'),
            saturation: requireFiniteNumber(runtimeState.domainSaturation, 'Domain saturation'),
            lightnessCycles: requireFiniteNumber(runtimeState.domainLightnessCycles, 'Domain lightness cycles')
        },
        paletteStops: paletteStops(runtimeState.domainPalette),
        viewport: domainViewportSnapshot(planeParams, width, height)
    };

    if (snapshot.polynomialCoeffs.length !== snapshot.polynomialN + 1) {
        throw new Error('Domain dynamics received invalid native map or style parameters.');
    }

    return freezeSnapshot(snapshot);
}

function freezeSnapshot(value, seen = new WeakSet()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    for (const child of Object.values(value)) freezeSnapshot(child, seen);
    return Object.freeze(value);
}

export const domainStatus = signal(runtime.rendering.domainDynamicsStats);

function report(status) {
    runtime.rendering.domainDynamicsStats = status;
    domainStatus.value = status;
}

export function isPlanarDomainVisible(runtimeState) {
    return runtimeState.domainColoringEnabled && !runtimeState.realPlotsEnabled &&
        !runtimeState.laplaceModeEnabled && !runtimeState.manifoldTransformationEnabled;
}

export function synchronizePlanarDomainVisibility(runtimeState) {
    const canvas = context.zDomainColorCanvas;
    if (!canvas) return;
    const visible = isPlanarDomainVisible(runtimeState);
    if (canvas.hidden === !visible) return;
    canvas.hidden = !visible;
    if (visible) context.domainColoringDirty = true;
    else cancelPlanarDomainDynamics();
}

export function renderPlanarDomainDynamics(canvas, planeParams, snapshot) {
    if (!canvas || !planeParams || !snapshot) throw new Error('Domain rendering requires its canvas, viewport, and map snapshot.');
    const signature = JSON.stringify(snapshot);
    if (signature === activeSignature) return;
    try {
        if (coordinator && coordinator.canvas !== canvas) { coordinator.dispose(); coordinator = null; }
        coordinator ??= new DomainCoordinator(canvas, report);
        activeSignature = signature;
        coordinator.render(snapshot);
    } catch (error) { failPlanarDomainDynamics(error); }
}

export function failPlanarDomainDynamics(error) {
    coordinator?.cancel();
    report(Object.freeze({ ...domainStatus.value, state: 'failed', message: error?.message || String(error) }));
}

export function cancelPlanarDomainDynamics() {
    coordinator?.cancel(); activeSignature = null;
    report(Object.freeze({ state: 'idle' }));
}

export function exportPlanarDomainImage() {
    if (!coordinator || domainStatus.value.state !== 'complete') throw new Error('Domain coloring must finish before image export.');
    return coordinator.exportImage();
}

export function disposePlanarDomainDynamics() {
    coordinator?.dispose(); coordinator = null; activeSignature = null;
    report(Object.freeze({ state: 'idle' }));
}
