/** @jsxImportSource preact */
import { useCallback, useRef } from 'preact/hooks';
import { getChainingTitleHTML, registerChainedPlane, unregisterChainedPlane } from '../../utils/dom-utils.js';
import { useAppState } from '../state-hooks.js';
import { PanelEdgeControls } from './panel-edge-controls.jsx';
import { isFoldableInputShape } from '../../rendering/shape-generators.js';
import { RiemannSurfaceHud } from './riemann-surface-hud.jsx';

function ChainedPlane({ index, mode, derivative, outputLabel, fullscreen, fold }) {
    const canvasRef = useRef(null);
    const threeContainerRef = useRef(null);
    const setCanvas = useCallback(canvas => {
        if (!canvas && canvasRef.current) unregisterChainedPlane(index);
        canvasRef.current = canvas;
        if (canvas) registerChainedPlane(index, canvas, threeContainerRef.current);
    }, [index]);
    const setThreeContainer = useCallback(container => {
        threeContainerRef.current = container;
        if (canvasRef.current) registerChainedPlane(index, canvasRef.current, container);
    }, [index]);

    return <div id={`w_plane_column_${index}`} class={`plane-column${fullscreen ? ' workspace-panel-fullscreen' : ''}`}>
        <div class="canvas-header-line">
            <h2 class="section-title">
                <span id={`w-plane-title_${index}`}>
                    {outputLabel} (Chain {index}: {derivative ? 'Derivative of ' : ''}
                    <code id={`w-plane-title-func_${index}`}>{getChainingTitleHTML(index, mode)}</code>)
                </span>
            </h2>
            <div class="canvas-header-controls">
                <button id={`toggle_fullscreen_w_btn_${index}`} class="icon-button canvas-icon-button"
                    type="button" aria-label={`Toggle fullscreen view for output chain ${index}`}>
                    <i data-lucide="maximize-2" aria-hidden="true" />
                    <span class="hidden-visually">Toggle fullscreen view</span>
                </button>
            </div>
        </div>
        <div class="canvas-layer-host">
            <canvas id={`w_plane_canvas_${index}`} ref={setCanvas} class={fold ? 'hidden' : ''} />
            <RiemannSurfaceHud planeIndex={index} />
            <div id={`w_plane_three_container_${index}`} ref={setThreeContainer}
                class={`${fold ? '' : 'hidden ' }fill-container`} />
            <div id={`w_plane_probe_info_${index}`} class="probe-info-overlay hidden" />
            <div id={`cauchy_integral_results_info_${index}`} class="cauchy-info-overlay hidden analysis-copy" />
        </div>
        <PanelEdgeControls />
    </div>;
}

export function ChainedPlaneColumns() {
    const enabled = useAppState('chainingEnabled');
    const count = useAppState('chainCount');
    const mode = useAppState('chainingMode');
    const derivative = useAppState('mapPresentation') === 'derivative';
    const riemann = useAppState('riemannSurfaceEnabled');
    const manifold = useAppState('manifold3dViewEnabled');
    const foldEnabled = useAppState('foldSurface3dEnabled');
    const inputShape = useAppState('currentInputShape');
    const wFullscreen = useAppState('isWFullScreen');
    const fullscreenIndex = useAppState('fullscreenWIndex');
    const visibleCount = enabled && count <= 25 ? count : 1;
    const outputLabel = riemann ? 'Riemann surface' : manifold ? '3D Manifold' : 'w-plane';
    const fold = foldEnabled && (inputShape === 'media' || isFoldableInputShape(inputShape)) && !riemann && !manifold;

    return Array.from({ length: Math.max(0, visibleCount - 1) }, (_, offset) => {
        const index = offset + 1;
        return <ChainedPlane key={index} index={index} mode={mode} derivative={derivative}
            outputLabel={outputLabel} fullscreen={wFullscreen && fullscreenIndex === index} fold={fold} />;
    });
}
