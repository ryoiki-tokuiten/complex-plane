import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { state, context } from '../store/state.js';
import { disposeThreeObject, createCanvasTextSprite } from './three-utils.js';
import { computeCenterOfMassFrequencySweep } from '../analysis/laplace-transform.js';

const BACKGROUND = 0x05060b;
const AXIS_COLOR = 0xaeb8cc;
const GRID_COLOR = 0x43506b;
const INPUT_TICK_COLOR = 0xf3f6ff;
const RE_COLOR = 0xffd45f;
const IM_COLOR = 0x5dd8e8;
const SUM_COLOR = 0xffd43b;
const SUM_EMERALD = 0x10b981;
const TRACER_COLOR = 0xff9add;
const PEAK_MARKER_COLOR = 0xff528f;

const INPUT_AXIS_HALF = 4.4;
const OUTPUT_AXIS_HALF = 2.05;
const STACK_X_SPACING = 11.0;
const STACK_Z_SPACING = 7.5;
const EPSILON = 1e-10;

let activeRenderer = null;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function scaledOutputCoordinate(value, outputScale, halfExtent) {
    if (!Number.isFinite(value)) return 0;
    const scale = Math.max(EPSILON, outputScale);
    const ratio = value / scale;
    const magnitude = Math.abs(ratio);
    const signed = magnitude <= 1
        ? ratio
        : Math.sign(ratio) * (1 + Math.tanh((magnitude - 1) * 0.55) * 0.18);
    return signed * halfExtent;
}

function clearThreeGroup(group) {
    while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        disposeThreeObject(child);
    }
}

function makeTextSprite(text, options = {}) {
    return createCanvasTextSprite(THREE, text, {
        color: options.color || 'rgba(235, 239, 250, 0.95)',
        fontSize: options.fontSize || 40,
        weight: options.weight || 600,
        shadowColor: 'rgba(0, 0, 0, 0.75)',
        shadowBlur: 12,
        height: options.height || (options.scale ? options.scale[1] : 0.35)
    });
}

function addLabel(group, text, position, options = {}) {
    const sprite = makeTextSprite(text, options);
    sprite.position.copy(position);
    group.add(sprite);
    return sprite;
}

function addLineSegments(group, segments, options = {}) {
    if (!segments.length) return;
    const positions = [];

    segments.forEach(segment => {
        const [a, b] = segment;
        if (a && b) {
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
        color: options.color ?? 0xffffff,
        transparent: (options.opacity ?? 1) < 1,
        opacity: options.opacity ?? 1,
        depthWrite: false
    });
    group.add(new THREE.LineSegments(geometry, material));
}

function appendPolylineSegments(target, points) {
    for (let index = 1; index < points.length; index += 1) {
        target.push([points[index - 1], points[index]]);
    }
}

function addPointCloud(group, points, options = {}) {
    if (!points.length) return;
    const positions = [];
    points.forEach(point => {
        if (point) positions.push(point.x, point.y, point.z);
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color: options.color ?? 0xffffff,
        size: options.size ?? 6,
        transparent: (options.opacity ?? 1) < 1,
        opacity: options.opacity ?? 1,
        sizeAttenuation: false,
        depthWrite: false
    });
    group.add(new THREE.Points(geometry, material));
}

function getDecomposedFrequencies() {
    const count = Math.max(1, Math.min(16, state.fourier3DParallelGraphs || 4));
    const baseFreq = Math.max(0.2, Math.abs(state.laplaceFrequency || 1.0));
    const duration = Math.max(0.5, state.laplaceTimeWindow || 4.0);
    const spectrum = state.laplaceSpectrum;
    const freqs = [];

    if (Array.isArray(spectrum) && spectrum.length > 1) {
        const sorted = [...spectrum]
            .filter(pt => pt.k > 0 && (pt.magnitude || 0) > 1e-3)
            .sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0));
        
        for (const pt of sorted) {
            const f = pt.k / duration;
            if (f >= 0.1 && f <= 30.0 && !freqs.some(existing => Math.abs(existing - f) < 0.25)) {
                freqs.push(f);
                if (freqs.length >= count) break;
            }
        }
    }

    let multiplier = 1;
    while (freqs.length < count) {
        const candidate = multiplier * baseFreq;
        if (!freqs.some(existing => Math.abs(existing - candidate) < 0.25)) {
            freqs.push(candidate);
        }
        multiplier++;
    }
    freqs.sort((a, b) => a - b);
    return freqs.slice(0, count);
}

export class Fourier3DPipelineRenderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-18, 18, 11, -11, 0.08, 10000);
        const cameraTarget = new THREE.Vector3(0, 0, 0);
        const cameraOffset = new THREE.Vector3(6.7, 4.9, 6.5).normalize().multiplyScalar(2500);
        this.camera.position.copy(cameraTarget).add(cameraOffset);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
            depth: true,
            stencil: false,
            preserveDrawingBuffer: true
        });
        this.renderer.setClearColor(BACKGROUND);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.syncPixelRatio();
        this.container.replaceChildren(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.enablePan = true;
        this.controls.enableZoom = true;
        this.controls.zoomToCursor = true;
        this.controls.screenSpacePanning = true;
        this.controls.target.copy(cameraTarget);
        this.controls.update();
        this.controls.saveState();
        this.controls.addEventListener('change', () => this.render());

        this.contentGroup = new THREE.Group();
        this.scene.add(this.contentGroup);
        this.addLights();

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    syncPixelRatio() {
        const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
        this.renderer.setPixelRatio(Math.min(ratio, 2.5));
    }

    addLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.34));
        this.scene.add(new THREE.HemisphereLight(0xe9f1ff, 0x050510, 1.55));

        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.set(5, 7, 5);
        this.scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0x8ed8ff, 1.15);
        rimLight.position.set(-5, 3, -5);
        this.scene.add(rimLight);
    }

    resize() {
        const width = this.container.clientWidth || window.innerWidth || 1;
        const height = this.container.clientHeight || window.innerHeight || 1;
        const aspect = width / height;

        const frustumHeight = 24.0;
        let halfHeight = frustumHeight * 0.5;
        let halfWidth = halfHeight * aspect;

        this.syncPixelRatio();
        this.camera.left = -halfWidth;
        this.camera.right = halfWidth;
        this.camera.top = halfHeight;
        this.camera.bottom = -halfHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
        this.render();
    }

    render() {
        clearThreeGroup(this.contentGroup);

        const duration = Math.max(0.5, state.laplaceTimeWindow || 4.0);
        const sampleCount = Math.max(32, state.laplaceSamples || 1024);
        const sigma = Number.isFinite(state.laplaceSigma) ? state.laplaceSigma : 0;
        const progress = clamp(state.laplaceAnimationTime ?? 1.0, 0, 1);

        const frequencies = getDecomposedFrequencies();
        const maxFreq = Math.max(8.0, (frequencies[frequencies.length - 1] || 4.0) * 1.5);
        const sweepSteps = 200;

        const totalRows = frequencies.length + 1; // constituent frequencies + 1 sum row
        const centerIndex = (totalRows - 1) * 0.5;
        const spacing = STACK_Z_SPACING;

        const stackX1 = -STACK_X_SPACING; // Stack 1: Waveforms g(t) vs Time t
        const stackX2 = 0;                // Stack 2: X-COM Graph Re(COM)(f) vs Frequency f
        const stackX3 = STACK_X_SPACING;  // Stack 3: Y-COM Graph Im(COM)(f) vs Frequency f

        const windingFreqHz = Math.abs(state.laplaceOmega || 1.0) / (2 * Math.PI);

        // 1. GENERATE CONSTITUENT SIGNALS & THEIR COM FREQUENCY SWEEPS
        const constituentSignals = [];
        const constituentSweeps = [];

        let globalMaxWavePeak = 1e-4;
        let globalMaxComPeak = 1e-4;

        frequencies.forEach(freq => {
            const sig = [];
            for (let i = 0; i < sampleCount; i++) {
                const t = (i / (sampleCount - 1)) * duration;
                const val = Math.cos(2 * Math.PI * freq * t) * Math.exp(-sigma * t);
                sig.push({ t, value: val });
                globalMaxWavePeak = Math.max(globalMaxWavePeak, Math.abs(val));
            }
            constituentSignals.push(sig);

            const sweep = computeCenterOfMassFrequencySweep(sig, {
                sigma,
                minFreq: 0,
                maxFreq,
                steps: sweepSteps
            });
            constituentSweeps.push(sweep);

            sweep.forEach(pt => {
                globalMaxComPeak = Math.max(globalMaxComPeak, Math.abs(pt.real), Math.abs(pt.imag));
            });
        });

        // 2. ACTIVE / SUM SIGNAL & ITS COM SWEEP
        // If state.laplaceTimeDomainSignal exists, use the actual currently selected signal!
        let activeSumSignal = state.laplaceTimeDomainSignal;
        if (!Array.isArray(activeSumSignal) || activeSumSignal.length < 2) {
            activeSumSignal = [];
            for (let i = 0; i < sampleCount; i++) {
                const t = (i / (sampleCount - 1)) * duration;
                let sumVal = 0;
                for (let k = 0; k < frequencies.length; k++) {
                    sumVal += constituentSignals[k][i].value;
                }
                activeSumSignal.push({ t, value: sumVal });
            }
        }

        for (let i = 0; i < activeSumSignal.length; i++) {
            globalMaxWavePeak = Math.max(globalMaxWavePeak, Math.abs(activeSumSignal[i].value));
        }

        const sumComSweep = computeCenterOfMassFrequencySweep(activeSumSignal, {
            sigma,
            minFreq: 0,
            maxFreq,
            steps: sweepSteps
        });

        sumComSweep.forEach(pt => {
            globalMaxComPeak = Math.max(globalMaxComPeak, Math.abs(pt.real), Math.abs(pt.imag));
        });

        const scaleWaveY = val => scaledOutputCoordinate(val, globalMaxWavePeak, OUTPUT_AXIS_HALF * 0.82);
        const scaleComY = val => scaledOutputCoordinate(val, globalMaxComPeak, OUTPUT_AXIS_HALF * 0.82);

        // Geometric collections matching transformation-graph pipeline
        const axes = [];
        const grids = [];
        const ticks = [];
        const waveCurves = [];
        const comXCurves = [];
        const comYCurves = [];
        const sumWaveCurves = [];
        const sumComXCurves = [];
        const sumComYCurves = [];
        const cursors = [];
        const peakMarkers = [];
        const peakLines = [];

        // Stack Headers (positioned above the topmost layer)
        const headerZ = -centerIndex * spacing - 2.8;
        addLabel(this.contentGroup, 'Stack 1: Time Domain Signal g(t)', new THREE.Vector3(stackX1, OUTPUT_AXIS_HALF + 1.4, headerZ), {
            color: 'rgba(255, 222, 124, 0.98)',
            height: 0.48,
            fontSize: 44
        });
        addLabel(this.contentGroup, 'x: Time t (s)  |  y: Amplitude g(t)', new THREE.Vector3(stackX1, OUTPUT_AXIS_HALF + 0.85, headerZ), {
            color: 'rgba(200, 215, 245, 0.78)',
            height: 0.28,
            fontSize: 32
        });

        addLabel(this.contentGroup, 'Stack 2: x-coordinate of Center of Mass', new THREE.Vector3(stackX2, OUTPUT_AXIS_HALF + 1.4, headerZ), {
            color: 'rgba(255, 120, 180, 0.98)',
            height: 0.48,
            fontSize: 44
        });
        addLabel(this.contentGroup, 'x: Frequency f (Hz)  |  y: Re[COM](f)', new THREE.Vector3(stackX2, OUTPUT_AXIS_HALF + 0.85, headerZ), {
            color: 'rgba(200, 215, 245, 0.78)',
            height: 0.28,
            fontSize: 32
        });

        addLabel(this.contentGroup, 'Stack 3: y-coordinate of Center of Mass', new THREE.Vector3(stackX3, OUTPUT_AXIS_HALF + 1.4, headerZ), {
            color: 'rgba(122, 219, 236, 0.98)',
            height: 0.48,
            fontSize: 44
        });
        addLabel(this.contentGroup, 'x: Frequency f (Hz)  |  y: Im[COM](f)', new THREE.Vector3(stackX3, OUTPUT_AXIS_HALF + 0.85, headerZ), {
            color: 'rgba(200, 215, 245, 0.78)',
            height: 0.28,
            fontSize: 32
        });

        // Helper to construct a normalized rectangular 3D frame with axis markers
        const build3DFrame = (centerX, laneZ, xMinLabel, xCenterLabel, xMaxLabel, yTopLabel, yComponentLabel) => {
            const x0 = centerX - INPUT_AXIS_HALF;
            const x1 = centerX + INPUT_AXIS_HALF;
            const y0 = -OUTPUT_AXIS_HALF;
            const y1 = OUTPUT_AXIS_HALF;

            // Coordinate axes
            axes.push([new THREE.Vector3(x0, 0, laneZ), new THREE.Vector3(x1, 0, laneZ)]);
            axes.push([new THREE.Vector3(x0, y0, laneZ), new THREE.Vector3(x0, y1, laneZ)]);

            // Vertical grid lines and ticks
            for (let i = 0; i <= 6; i++) {
                const gx = lerp(x0, x1, i / 6);
                grids.push([new THREE.Vector3(gx, y0, laneZ), new THREE.Vector3(gx, y1, laneZ)]);
                ticks.push([new THREE.Vector3(gx, -0.08, laneZ), new THREE.Vector3(gx, 0.08, laneZ)]);
            }
            // Horizontal grid lines
            [-1, -0.5, 0.5, 1].forEach(ratio => {
                grids.push([new THREE.Vector3(x0, ratio * y1, laneZ), new THREE.Vector3(x1, ratio * y1, laneZ)]);
            });

            // --- EXPLICIT X-AXIS LABELS ---
            addLabel(this.contentGroup, xMinLabel, new THREE.Vector3(x0, y0 - 0.28, laneZ), {
                color: 'rgba(174, 184, 204, 0.82)',
                height: 0.22,
                fontSize: 30
            });
            addLabel(this.contentGroup, xCenterLabel, new THREE.Vector3(centerX, y0 - 0.28, laneZ), {
                color: 'rgba(220, 230, 250, 0.88)',
                height: 0.26,
                fontSize: 34
            });
            addLabel(this.contentGroup, xMaxLabel, new THREE.Vector3(x1, y0 - 0.28, laneZ), {
                color: 'rgba(174, 184, 204, 0.82)',
                height: 0.22,
                fontSize: 30
            });

            // --- EXPLICIT Y-AXIS LABELS ---
            addLabel(this.contentGroup, yTopLabel, new THREE.Vector3(x0 - 0.55, y1 + 0.25, laneZ), {
                color: 'rgba(255, 235, 160, 0.95)',
                height: 0.26,
                fontSize: 34
            });
            addLabel(this.contentGroup, `+${yComponentLabel}`, new THREE.Vector3(x0 - 0.45, y1 * 0.72, laneZ), {
                color: 'rgba(174, 184, 204, 0.75)',
                height: 0.20,
                fontSize: 28
            });
            addLabel(this.contentGroup, `-${yComponentLabel}`, new THREE.Vector3(x0 - 0.45, y0 * 0.72, laneZ), {
                color: 'rgba(174, 184, 204, 0.75)',
                height: 0.20,
                fontSize: 28
            });
        };

        const activeTimeIdx = Math.min(sampleCount - 1, Math.floor(progress * (sampleCount - 1)));

        // 3. RENDER PARALLEL FREQUENCY LANES (Synced at equal Z layers)
        frequencies.forEach((freq, k) => {
            const laneZ = (k - centerIndex) * spacing;
            const sig = constituentSignals[k];
            const sweep = constituentSweeps[k];

            // --- STACK 1: Waveform Graph g_k(t) vs Time ---
            build3DFrame(stackX1, laneZ, '0s', 'Time t (s) →', `${duration.toFixed(1)}s`, 'gₖ(t)', 'Amp');
            const x0_1 = stackX1 - INPUT_AXIS_HALF;
            const x1_1 = stackX1 + INPUT_AXIS_HALF;
            const wavePts = sig.map(pt => {
                const cx = lerp(x0_1, x1_1, pt.t / duration);
                const cy = scaleWaveY(pt.value);
                return new THREE.Vector3(cx, cy, laneZ);
            });
            appendPolylineSegments(waveCurves, wavePts);

            if (wavePts[activeTimeIdx]) cursors.push(wavePts[activeTimeIdx]);

            addLabel(this.contentGroup, `Harmonic: fₖ = ${freq.toFixed(1)} Hz`, new THREE.Vector3(stackX1, -OUTPUT_AXIS_HALF - 0.65, laneZ), {
                color: 'rgba(255, 222, 124, 0.95)',
                height: 0.32,
                fontSize: 36
            });

            // --- STACK 2: X-COM Graph Re(COM)(f) vs Frequency ---
            build3DFrame(stackX2, laneZ, '0 Hz', 'Frequency f (Hz) →', `${maxFreq.toFixed(1)} Hz`, 'Re(COM)', '1.0');
            const x0_2 = stackX2 - INPUT_AXIS_HALF;
            const x1_2 = stackX2 + INPUT_AXIS_HALF;
            const comXPts = sweep.map(pt => {
                const cx = lerp(x0_2, x1_2, pt.freq / maxFreq);
                const cy = scaleComY(pt.real);
                return new THREE.Vector3(cx, cy, laneZ);
            });
            appendPolylineSegments(comXCurves, comXPts);

            // Peak marker at resonance frequency f = freq
            const peakCx = lerp(x0_2, x1_2, freq / maxFreq);
            const peakPt = new THREE.Vector3(peakCx, scaleComY(0.5), laneZ);
            peakMarkers.push(peakPt);
            peakLines.push([new THREE.Vector3(peakCx, 0, laneZ), peakPt]);

            // Winding frequency tracer dot on X-COM curve (3b1b white dot!)
            if (windingFreqHz <= maxFreq) {
                const windX = lerp(x0_2, x1_2, windingFreqHz / maxFreq);
                const sweepPt = sweep.find(p => p.freq >= windingFreqHz) || sweep[0];
                const windY = scaleComY(sweepPt ? sweepPt.real : 0);
                cursors.push(new THREE.Vector3(windX, windY, laneZ));
            }

            // --- STACK 3: Y-COM Graph Im(COM)(f) vs Frequency ---
            build3DFrame(stackX3, laneZ, '0 Hz', 'Frequency f (Hz) →', `${maxFreq.toFixed(1)} Hz`, 'Im(COM)', '1.0');
            const x0_3 = stackX3 - INPUT_AXIS_HALF;
            const x1_3 = stackX3 + INPUT_AXIS_HALF;
            const comYPts = sweep.map(pt => {
                const cx = lerp(x0_3, x1_3, pt.freq / maxFreq);
                const cy = scaleComY(pt.imag);
                return new THREE.Vector3(cx, cy, laneZ);
            });
            appendPolylineSegments(comYCurves, comYPts);
            
            if (windingFreqHz <= maxFreq) {
                const windX = lerp(x0_3, x1_3, windingFreqHz / maxFreq);
                const sweepPt = sweep.find(p => p.freq >= windingFreqHz) || sweep[0];
                const windY = scaleComY(sweepPt ? sweepPt.imag : 0);
                cursors.push(new THREE.Vector3(windX, windY, laneZ));
            }
        });

        // 4. RENDER FINAL SUM ROW (All Summed Graphs Synced at Z_sum)
        const sumLaneZ = (frequencies.length - centerIndex) * spacing;

        // --- STACK 1 SUM: Composite Waveform Graph ---
        build3DFrame(stackX1, sumLaneZ, '0s', 'Time t (s) →', `${duration.toFixed(1)}s`, 'g(t)', 'Amp');
        const sx0_1 = stackX1 - INPUT_AXIS_HALF;
        const sx1_1 = stackX1 + INPUT_AXIS_HALF;
        const sumWavePts = activeSumSignal.map(pt => {
            const cx = lerp(sx0_1, sx1_1, pt.t / duration);
            const cy = scaleWaveY(pt.value);
            return new THREE.Vector3(cx, cy, sumLaneZ);
        });
        appendPolylineSegments(sumWaveCurves, sumWavePts);

        const sumActiveTimeIdx = Math.min(activeSumSignal.length - 1, Math.floor(progress * (activeSumSignal.length - 1)));
        if (sumWavePts[sumActiveTimeIdx]) cursors.push(sumWavePts[sumActiveTimeIdx]);

        addLabel(this.contentGroup, 'Σ Signal: g(t) [Active Waveform]', new THREE.Vector3(stackX1, -OUTPUT_AXIS_HALF - 0.65, sumLaneZ), {
            color: 'rgba(255, 212, 59, 0.98)',
            height: 0.34,
            fontSize: 38,
            weight: 700
        });

        // --- STACK 2 SUM: Full Composite Fourier X-COM Graph (All Resonance Peaks Summed) ---
        build3DFrame(stackX2, sumLaneZ, '0 Hz', 'Frequency f (Hz) →', `${maxFreq.toFixed(1)} Hz`, 'Re(COM_Σ)', '1.0');
        const sx0_2 = stackX2 - INPUT_AXIS_HALF;
        const sx1_2 = stackX2 + INPUT_AXIS_HALF;
        const sumComXPts = sumComSweep.map(pt => {
            const cx = lerp(sx0_2, sx1_2, pt.freq / maxFreq);
            const cy = scaleComY(pt.real);
            return new THREE.Vector3(cx, cy, sumLaneZ);
        });
        appendPolylineSegments(sumComXCurves, sumComXPts);

        // Peak markers at all frequency components in the sum graph
        frequencies.forEach(f => {
            const peakCx = lerp(sx0_2, sx1_2, f / maxFreq);
            const peakPt = new THREE.Vector3(peakCx, scaleComY(0.5 / frequencies.length), sumLaneZ);
            peakMarkers.push(peakPt);
            peakLines.push([new THREE.Vector3(peakCx, 0, sumLaneZ), peakPt]);
        });

        if (windingFreqHz <= maxFreq) {
            const windX = lerp(sx0_2, sx1_2, windingFreqHz / maxFreq);
            const sweepPt = sumComSweep.find(p => p.freq >= windingFreqHz) || sumComSweep[0];
            const windY = scaleComY(sweepPt ? sweepPt.real : 0);
            cursors.push(new THREE.Vector3(windX, windY, sumLaneZ));
        }

        addLabel(this.contentGroup, 'Σ Fourier Transform: Re[COM_Σ(f)]', new THREE.Vector3(stackX2, -OUTPUT_AXIS_HALF - 0.65, sumLaneZ), {
            color: 'rgba(52, 211, 153, 0.98)',
            height: 0.34,
            fontSize: 38,
            weight: 700
        });

        // --- STACK 3 SUM: Composite Y-COM Graph ---
        build3DFrame(stackX3, sumLaneZ, '0 Hz', 'Frequency f (Hz) →', `${maxFreq.toFixed(1)} Hz`, 'Im(COM_Σ)', '1.0');
        const sx0_3 = stackX3 - INPUT_AXIS_HALF;
        const sx1_3 = stackX3 + INPUT_AXIS_HALF;
        const sumComYPts = sumComSweep.map(pt => {
            const cx = lerp(sx0_3, sx1_3, pt.freq / maxFreq);
            const cy = scaleComY(pt.imag);
            return new THREE.Vector3(cx, cy, sumLaneZ);
        });
        appendPolylineSegments(sumComYCurves, sumComYPts);
        
        if (windingFreqHz <= maxFreq) {
            const windX = lerp(sx0_3, sx1_3, windingFreqHz / maxFreq);
            const sweepPt = sumComSweep.find(p => p.freq >= windingFreqHz) || sumComSweep[0];
            const windY = scaleComY(sweepPt ? sweepPt.imag : 0);
            cursors.push(new THREE.Vector3(windX, windY, sumLaneZ));
        }

        addLabel(this.contentGroup, 'Σ Fourier Transform: Im[COM_Σ(f)]', new THREE.Vector3(stackX3, -OUTPUT_AXIS_HALF - 0.65, sumLaneZ), {
            color: 'rgba(56, 189, 248, 0.98)',
            height: 0.34,
            fontSize: 38,
            weight: 700
        });

        // Render line layers matching transformation graph aesthetics
        addLineSegments(this.contentGroup, axes, { color: AXIS_COLOR, opacity: 0.65 });
        addLineSegments(this.contentGroup, grids, { color: GRID_COLOR, opacity: 0.18 });
        addLineSegments(this.contentGroup, ticks, { color: INPUT_TICK_COLOR, opacity: 0.5 });
        addLineSegments(this.contentGroup, waveCurves, { color: RE_COLOR, opacity: 0.92 });
        addLineSegments(this.contentGroup, comXCurves, { color: 0xff70a6, opacity: 0.95 });
        addLineSegments(this.contentGroup, comYCurves, { color: IM_COLOR, opacity: 0.92 });
        addLineSegments(this.contentGroup, sumWaveCurves, { color: SUM_COLOR, opacity: 0.98 });
        addLineSegments(this.contentGroup, sumComXCurves, { color: SUM_EMERALD, opacity: 0.98 });
        addLineSegments(this.contentGroup, sumComYCurves, { color: 0x38bdf8, opacity: 0.98 });
        addLineSegments(this.contentGroup, peakLines, { color: 0xff528f, opacity: 0.45 });

        addPointCloud(this.contentGroup, peakMarkers, { color: PEAK_MARKER_COLOR, size: 7, opacity: 0.95 });
        addPointCloud(this.contentGroup, cursors, { color: TRACER_COLOR, size: 7, opacity: 0.95 });

        this.renderer.render(this.scene, this.camera);
    }

    dispose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.controls) {
            this.controls.dispose();
            this.controls = null;
        }
        if (this.renderer) {
            this.renderer.dispose();
            if (this.renderer.domElement && this.renderer.domElement.parentElement) {
                this.renderer.domElement.remove();
            }
            this.renderer = null;
        }
        clearThreeGroup(this.contentGroup);
    }
}

export function drawFourier3DPipeline() {
    const container = context.controls.fourier3DContainer;
    if (!container) return;
    if (!activeRenderer || activeRenderer.container !== container) {
        if (activeRenderer) activeRenderer.dispose();
        activeRenderer = new Fourier3DPipelineRenderer(container);
    }
    activeRenderer.render();
}

export function disposeFourier3DPipeline() {
    if (activeRenderer) {
        activeRenderer.dispose();
        activeRenderer = null;
    }
}
