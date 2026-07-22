import { state, context } from '../store/state.js';
import { runtime } from '../store/runtime.js';
import { eventBus } from '../store/events.js';
const { controls } = context;

function requestDomainRedraw() {
    eventBus.emit('redraw:domain');
}
function requestRedrawAll() {
    eventBus.emit('redraw:all');
}

const RASTER_INPUT_SHAPES = new Set(['image', 'video']);
const RASTER_MEDIA_TIME_EPSILON = 1e-4;



export function isRasterInputShape(shape = state.currentInputShape) {
    return RASTER_INPUT_SHAPES.has(shape);
}

export function getRasterSourceForShape(shape = state.currentInputShape) {
    return shape === 'video' ? runtime.media.video : runtime.media.image;
}



export function getRasterResolutionForShape(shape = state.currentInputShape) {
    return shape === 'video' ? state.videoResolution : state.imageResolution;
}

export function getRasterSizeForShape(shape = state.currentInputShape) {
    return shape === 'video' ? state.videoSize : state.imageSize;
}

export function getRasterOpacityForShape(shape = state.currentInputShape) {
    return shape === 'video' ? state.videoOpacity : state.imageOpacity;
}

export function getRasterAspectRatioForShape(shape = state.currentInputShape) {
    const aspectRatio = shape === 'video' ? state.videoAspectRatio : state.imageAspectRatio;
    return Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
}

export function getRasterVersionTokenForShape(shape = state.currentInputShape) {
    return shape === 'video' ? state.videoFrameVersion : state.imageContentVersion;
}

export function getRasterSourceDimensions(source) {
    if (!source) {
        return { width: 0, height: 0, aspectRatio: 1 };
    }

    const width = Math.max(
        0,
        source.videoWidth || source.naturalWidth || source.width || 0
    );
    const height = Math.max(
        0,
        source.videoHeight || source.naturalHeight || source.height || 0
    );

    if (!width || !height) {
        return { width: 0, height: 0, aspectRatio: 1 };
    }

    return {
        width,
        height,
        aspectRatio: width / height
    };
}

export function getRasterDisplayDimensions(shape = state.currentInputShape) {
    const size = Math.max(0.1, getRasterSizeForShape(shape) || 2.0);
    const aspectRatio = getRasterAspectRatioForShape(shape);

    if (aspectRatio >= 1) {
        return {
            width: size,
            height: size / aspectRatio
        };
    }

    return {
        width: size * aspectRatio,
        height: size
    };
}





export function processUploadedImageSource(img) {
    if (!img) {
        return false;
    }

    runtime.media.image = img;
    const { aspectRatio } = getRasterSourceDimensions(img);
    state.imageAspectRatio = aspectRatio;
    state.imageContentVersion += 1;
    return true;
}

export function processUploadedVideoFrame(force = false) {
    const video = runtime.media.video;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return false;
    }

    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    if (!force && Math.abs(currentTime - runtime.media.lastProcessedMediaTime) < RASTER_MEDIA_TIME_EPSILON) {
        return false;
    }

    const { aspectRatio } = getRasterSourceDimensions(video);
    state.videoAspectRatio = aspectRatio;



    state.videoFrameVersion += 1;
    runtime.media.lastProcessedMediaTime = currentTime;
    syncVideoPlaybackUI();
    return true;
}

export function formatMediaClockTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
        return '--:--';
    }

    const wholeSeconds = Math.floor(totalSeconds);
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const seconds = wholeSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function buildVideoStatusText() {
    if (!runtime.media.video) {
        return state.videoStatusMessage || 'No video loaded.';
    }

    const video = runtime.media.video;
    const statusLabel = state.videoStatusMessage || (state.videoIsPlaying ? 'Playing' : 'Paused');
    const currentTime = formatMediaClockTime(video.currentTime);
    const duration = formatMediaClockTime(video.duration);
    const { width, height } = getRasterSourceDimensions(video);
    const dims = width && height ? ` · ${width}x${height}` : '';
    const fps = Math.max(1, Math.round(state.videoProcessingFps || 24));

    return `${statusLabel} · ${currentTime} / ${duration}${dims} · ${fps} FPS`;
}

export function syncVideoPlaybackUI() {
    if (controls.videoPlayPauseBtn) {
        controls.videoPlayPauseBtn.disabled = !runtime.media.video;
        controls.videoPlayPauseBtn.textContent = state.videoIsPlaying ? '⏸ Pause' : '▶ Play';
    }

    if (controls.videoStatusDisplay) {
        controls.videoStatusDisplay.textContent = buildVideoStatusText();
    }
}

export function stopVideoProcessingLoop() {
    if (runtime.media.processingFrame) {
        cancelAnimationFrame(runtime.media.processingFrame);
        runtime.media.processingFrame = null;
    }
}

export function runVideoProcessingLoop(now) {
    runtime.media.processingFrame = null;

    if (!runtime.media.video || !state.videoIsPlaying || state.currentInputShape !== 'video') {
        syncVideoPlaybackUI();
        return;
    }

    const targetFps = Math.max(1, state.videoProcessingFps || 24);
    const targetInterval = 1000 / targetFps;
    const elapsed = now - runtime.media.lastProcessedWallTime;

    if (elapsed >= targetInterval) {
        if (processUploadedVideoFrame()) {
            runtime.media.lastProcessedWallTime = now;
            if (typeof requestDomainRedraw === 'function') {
                requestDomainRedraw(false);
            } else if (typeof requestRedrawAll === 'function') {
                requestRedrawAll();
            }
        } else {
            syncVideoPlaybackUI();
        }
    }

    runtime.media.processingFrame = requestAnimationFrame(runVideoProcessingLoop);
}

export function startVideoProcessingLoop() {
    stopVideoProcessingLoop();

    if (!runtime.media.video || !state.videoIsPlaying || state.currentInputShape !== 'video') {
        syncVideoPlaybackUI();
        return;
    }

    runtime.media.lastProcessedWallTime = performance.now() - (1000 / Math.max(1, state.videoProcessingFps || 24));
    runtime.media.processingFrame = requestAnimationFrame(runVideoProcessingLoop);
    syncVideoPlaybackUI();
}

export function pauseUploadedVideoPlayback() {
    const video = runtime.media.video;
    if (video) {
        video.pause();
    }

    state.videoIsPlaying = false;
    if (runtime.media.video) {
        state.videoStatusMessage = 'Paused';
    }
    stopVideoProcessingLoop();
    syncVideoPlaybackUI();

    if (typeof requestRedrawAll === 'function') {
        requestRedrawAll();
    }
}

export function startUploadedVideoPlayback() {
    const video = runtime.media.video;
    if (!video) {
        syncVideoPlaybackUI();
        return Promise.resolve(false);
    }

    state.videoStatusMessage = 'Starting playback';
    syncVideoPlaybackUI();

    return video.play().then(() => {
        state.videoIsPlaying = true;
        state.videoStatusMessage = 'Playing';
        if (state.currentInputShape === 'video') {
            startVideoProcessingLoop();
        } else {
            stopVideoProcessingLoop();
        }

        syncVideoPlaybackUI();
        if (typeof requestRedrawAll === 'function') {
            requestRedrawAll();
        }
        return true;
    }).catch(error => {
        state.videoIsPlaying = false;
        state.videoStatusMessage = 'Ready to play';
        stopVideoProcessingLoop();
        syncVideoPlaybackUI();
        console.warn('Video playback could not start automatically:', error);
        return false;
    });
}

export function toggleUploadedVideoPlayback() {
    if (state.videoIsPlaying) {
        pauseUploadedVideoPlayback();
        return;
    }

    startUploadedVideoPlayback();
}

export function cleanupUploadedVideo() {
    const previousVideo = runtime.media.video;
    const previousUrl = runtime.media.videoUrl;

    runtime.media.video = null;
    runtime.media.videoUrl = '';
    state.videoIsPlaying = false;
    state.videoAspectRatio = 1.0;
    state.videoFrameVersion += 1;
    runtime.media.lastProcessedWallTime = 0;
    runtime.media.lastProcessedMediaTime = -1;
    state.videoStatusMessage = 'No video loaded.';

    stopVideoProcessingLoop();

    if (previousVideo) {
        previousVideo.pause();
        previousVideo.removeAttribute('src');
        try {
            previousVideo.load();
        } catch (error) {
            console.warn('Unable to fully reset previous video element:', error);
        }
    }

    if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
    }

    syncVideoPlaybackUI();
}

export function loadUploadedVideoFile(file) {
    cleanupUploadedVideo();

    if (!file) {
        return;
    }

    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);

    video.preload = 'auto';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    runtime.media.video = video;
    runtime.media.videoUrl = objectUrl;
    state.videoStatusMessage = 'Loading video';
    syncVideoPlaybackUI();

    const handleReady = () => {
        if (runtime.media.video !== video) {
            return;
        }

        processUploadedVideoFrame(true);
        state.videoStatusMessage = 'Ready to play';
        syncVideoPlaybackUI();

        if (typeof requestRedrawAll === 'function') {
            requestRedrawAll();
        }

        if (state.currentInputShape === 'video') {
            startUploadedVideoPlayback();
        }
    };

    video.addEventListener('loadeddata', handleReady, { once: true });
    video.addEventListener('play', () => {
        if (runtime.media.video !== video) {
            return;
        }
        state.videoIsPlaying = true;
        state.videoStatusMessage = 'Playing';
        if (state.currentInputShape === 'video') {
            startVideoProcessingLoop();
        }
        syncVideoPlaybackUI();
    });
    video.addEventListener('pause', () => {
        if (runtime.media.video !== video) {
            return;
        }
        state.videoIsPlaying = false;
        state.videoStatusMessage = 'Paused';
        stopVideoProcessingLoop();
        processUploadedVideoFrame(true);
        syncVideoPlaybackUI();
        if (typeof requestRedrawAll === 'function') {
            requestRedrawAll();
        }
    });
    video.addEventListener('error', () => {
        if (runtime.media.video !== video) {
            return;
        }
        state.videoIsPlaying = false;
        state.videoStatusMessage = 'Could not load video.';
        stopVideoProcessingLoop();
        syncVideoPlaybackUI();
    });

    video.src = objectUrl;
    video.load();
}
