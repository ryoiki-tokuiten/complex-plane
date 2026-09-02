/** @jsxImportSource preact */
import { toggleUploadedVideoPlayback, videoPlaybackUi } from '../../utils/raster-media.js';

export function VideoPlaybackButton() {
    const playback = videoPlaybackUi.value;
    return <button id="video_play_pause_btn" type="button" disabled={!playback.available}
        onClick={toggleUploadedVideoPlayback}>{playback.label}</button>;
}

export function VideoPlaybackStatus() {
    return <div id="video_status_display" class="media-status-text">{videoPlaybackUi.value.status}</div>;
}
