/** @jsxImportSource preact */
import { useAppState } from '../state-hooks.js';
import { getManifold } from '../../rendering/manifold-registry.js';
import {
    setManifoldTransformationProgress,
    setManifoldTransformationSpeed,
    toggleManifoldTransformationAnimation
} from '../../rendering/manifold-transformation-animation.js';

const SPEEDS = [0.1, 0.5, 1];

function PlaybackIcon({ playing }) {
    return <svg viewBox="0 0 24 24">
        {playing
            ? <><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></>
            : <path d="M8 5v14l11-7z" />}
    </svg>;
}

export function ManifoldTransformationControls({ plane }) {
    const suffix = plane === 'z' ? 'Z' : 'W';
    const progress = useAppState(`manifoldTransformationProgress${suffix}`);
    const playing = useAppState(`manifoldTransformationPlaying${suffix}`);
    const speed = useAppState(`manifoldTransformationSpeed${suffix}`);
    const manifold = getManifold(useAppState('selectedManifold'));

    return <>
        <div class="transformation-hud-header">
            <span class="transformation-hud-title" id={`${plane}_transformation_title`}>{manifold.title}</span>
            <span class="transformation-hud-formula" id={`${plane}_transformation_formula`}>{manifold.formula}</span>
        </div>
        <div class="transformation-hud-controls">
            <button id={`${plane}_transformation_play_pause_btn`} type="button"
                class={`hud-play-btn${playing ? ' playing' : ''}`} aria-label="Play/Pause transformation animation"
                onClick={() => toggleManifoldTransformationAnimation(plane)}>
                <PlaybackIcon playing={playing} />
            </button>
            <div class="hud-slider-container">
                <input type="range" id={`${plane}_transformation_progress_slider`} min="0" max="1" step="0.001"
                    value={progress} onInput={event => setManifoldTransformationProgress(plane, event.currentTarget.value)} />
            </div>
            <div class="hud-speed-group" id={`${plane}_transformation_speed_group`}>
                {SPEEDS.map(value => <button type="button" class={`speed-btn${Math.abs(value - speed) < 0.01 ? ' active' : ''}`}
                    data-speed={value} data-plane={plane} title={`${value}x Speed`}
                    onClick={() => setManifoldTransformationSpeed(plane, value)}>{value}x</button>)}
            </div>
        </div>
        <div class="transformation-hud-footer">
            <span>Flat Plane ({plane})</span>
            <span id={`${plane}_transformation_manifold_label`}>{manifold.name}</span>
        </div>
    </>;
}
