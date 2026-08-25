import { state, context, subscribeState } from '../store/state.js';
import {
    buildPlanarDomainDynamicsSnapshot,
    cancelPlanarDomainDynamics,
    matchesPlanarDomainViewport,
    renderPlanarDomainDynamics
} from './domain-dynamics.js';
import { getDomainPaletteStops } from '../constants/domain-palettes.js';
import {
    DOMAIN_COLOR_LOG_MAGNITUDE_MIN,
    normalizeDomainColorLogMagnitude
} from '../constants/domain-dynamics.js';
import { requireFiniteNumber } from '../utils/numeric-contracts.js';
import { eventBus } from '../store/events.js';

const DOMAIN_LIGHTNESS_MIN = 0.34;
const DOMAIN_LIGHTNESS_MAX = 0.72;

subscribeState(() => {
    context.domainColoringDirty = true;
    eventBus.emit('redraw:domain', true);
}, [
    'currentFunction',
    'mapPresentation',
    'expBase',
    'logBase',
    'besselOrder',
    'algebraicChainingEnabled',
    'algebraicChainingZExpr',
    'algebraicChainingTerms',
    'chainingEnabled',
    'chainingMode',
    'chainCount',
    'orbitColoringMode',
    'polynomialN',
    'polynomialCoeffs',
    'fractionalPowerN',
    'branchCutType',
    'branchCutAngle',
    'zetaContinuationEnabled',
    'taylorSeriesEnabled',
    'taylorSeriesOrder',
    'taylorSeriesCenter',
    'taylorSeriesConvergenceRadius',
    'dynamicPlotting',
    'domainBrightness',
    'domainContrast',
    'domainSaturation',
    'domainLightnessCycles',
    'domainPalette'
]);

subscribeState(({ value }) => {
    context.domainColoringDirty = true;
    eventBus.emit('redraw:domain', true);
    if (!value) cancelPlanarDomainDynamics();
}, 'domainColoringEnabled');

export function domainMagnitudeLightness(logMod, cycles) {
    if (Number.isNaN(logMod)) throw new Error('Domain-color log magnitude must be a number.');
    const detail = requireFiniteNumber(cycles, 'Domain-color lightness detail');
    if (detail <= 0.0001) return 0.5;
    const normalized = normalizeDomainColorLogMagnitude(logMod);
    const tone = Math.min(1, Math.max(0,
        0.5 + (normalized - 0.5) * Math.max(0.05, detail)
    ));

    return DOMAIN_LIGHTNESS_MIN + (DOMAIN_LIGHTNESS_MAX - DOMAIN_LIGHTNESS_MIN) * tone;
}

export function renderPlanarDomainColoring(tCtx, pP) {
    const w = pP.width; const h = pP.height; if (w === 0 || h === 0) return;

    // Domain coloring intentionally bypasses active-map evaluators. Its native
    // worker pipeline renders viewport tiles directly into RGBA pixel buffers.
    const dynamicsSnapshot = buildPlanarDomainDynamicsSnapshot(state, pP);
    renderPlanarDomainDynamics(tCtx, pP, dynamicsSnapshot);
}

export { matchesPlanarDomainViewport };


export function getPaletteColor(paletteId, h) {
    const stops = getDomainPaletteStops(paletteId);
    const n = stops.length;
    const val = h * (n - 1);
    const idx = Math.min(n - 2, Math.floor(val));
    const t = val - idx;
    
    const cA = stops[idx];
    const cB = stops[idx + 1];
    
    return [
        cA[0] * (1 - t) + cB[0] * t,
        cA[1] * (1 - t) + cB[1] * t,
        cA[2] * (1 - t) + cB[2] * t
    ];
}

export function applyLightnessAndSaturation(rgb, L, S) {
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];

    // Apply lightness L
    if (L < 0.5) {
        const t = L / 0.5;
        r *= t;
        g *= t;
        b *= t;
    } else {
        const t = (L - 0.5) / 0.5;
        r = r * (1 - t) + t;
        g = g * (1 - t) + t;
        b = b * (1 - t) + t;
    }

    // Apply saturation S
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray * (1 - S) + r * S;
    g = gray * (1 - S) + g * S;
    b = gray * (1 - S) + b * S;

    return [
        Math.min(255, Math.max(0, Math.round(r * 255))),
        Math.min(255, Math.max(0, Math.round(g * 255))),
        Math.min(255, Math.max(0, Math.round(b * 255)))
    ];
}

export function domainColorForValue(re, im, runtimeState) {
    requireFiniteNumber(re, 'Domain-color real value');
    requireFiniteNumber(im, 'Domain-color imaginary value');
    if (!runtimeState || typeof runtimeState !== 'object') {
        throw new Error('Domain coloring requires explicit style state.');
    }
    const phase = Math.atan2(im, re);
    const scale = Math.max(Math.abs(re), Math.abs(im));
    const logMod = scale === 0
        ? DOMAIN_COLOR_LOG_MAGNITUDE_MIN
        : Math.log(scale) + 0.5 * Math.log((re / scale) ** 2 + (im / scale) ** 2);
    const cycles = requireFiniteNumber(runtimeState.domainLightnessCycles, 'Domain lightness detail');
    const lBase = domainMagnitudeLightness(logMod, cycles);

    const contrast = requireFiniteNumber(runtimeState.domainContrast, 'Domain contrast');
    const brightness = requireFiniteNumber(runtimeState.domainBrightness, 'Domain brightness');
    const saturation = requireFiniteNumber(runtimeState.domainSaturation, 'Domain saturation');

    const lContrasted = 0.5 + (lBase - 0.5) * contrast;
    const lFinal = Math.min(0.95, Math.max(0.05, lContrasted * brightness));
    const sFinal = Math.min(1.0, Math.max(0.0, saturation));
    let h = (phase / (2.0 * Math.PI)) % 1.0;
    if (h < 0) h += 1.0;

    if (typeof runtimeState.domainPalette !== 'string' || !runtimeState.domainPalette) {
        throw new Error('Domain coloring requires an explicit palette.');
    }
    const paletteId = runtimeState.domainPalette;
    const baseColor = getPaletteColor(paletteId, h);
    return applyLightnessAndSaturation(baseColor, lFinal, sFinal);
}
