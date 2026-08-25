import { state } from '../store/state.js';
import { domainColorForValue } from './domain-coloring.js';
import { domainPalettes, surfacePalettes } from '../ui/theme-manager.js';
import { DOMAIN_COLOR_LOG_MAGNITUDE_MAX, DOMAIN_COLOR_LOG_MAGNITUDE_MIN } from '../constants/domain-dynamics.js';
const $ = id => typeof id === 'string' ? document.getElementById(id) : id;

export function drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner) {
    const style = getComputedStyle(document.documentElement);
    const borderColor = style.getPropertyValue('--border-color') || 'rgba(255, 255, 255, 0.15)';
    const textColor = style.getPropertyValue('--text-color') || '#FAFAFA';

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - rOuter, cy); ctx.lineTo(cx + rOuter, cy);
    ctx.moveTo(cx, cy - rOuter); ctx.lineTo(cx, cy + rOuter);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
    ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.font = '500 13px Outfit, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', cx + rOuter + 16, cy);
    ctx.fillText('π/2', cx, cy - rOuter - 16);
    ctx.fillText('π', cx - rOuter - 16, cy);
    ctx.fillText('3π/2', cx, cy + rOuter + 16);
    ctx.restore();
}

export function drawDomainPaletteCircle(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2, rOuter = 130, rInner = 95;
    const imgData = ctx.createImageData(w, h), data = imgData.data;
    const tempState = {
        domainPalette: paletteId,
        domainBrightness: state.domainBrightness,
        domainContrast: state.domainContrast,
        domainSaturation: state.domainSaturation,
        domainLightnessCycles: 0
    };

    for (let y = 0; y < h; y++) {
        const dy = -(y - cy);
        for (let x = 0; x < w; x++) {
            const dx = x - cx, r = Math.hypot(dx, dy);
            if (r > rOuter + 1.5 || r < rInner - 1.5) continue;

            let alpha = 255;
            if (r > rOuter - 1.5) alpha = Math.max(0, Math.min(255, Math.round((rOuter + 1.5 - r) * 85)));
            else if (r < rInner + 1.5) alpha = Math.max(0, Math.min(255, Math.round((r - (rInner - 1.5)) * 85)));

            const phase = Math.atan2(dy, dx);
            const rgb = domainColorForValue(Math.cos(phase), Math.sin(phase), tempState);
            const idx = (y * w + x) * 4;
            data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = alpha;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner);
}

export function drawAmplitudeStrip(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    const imgData = ctx.createImageData(w, h), data = imgData.data;
    const tempState = {
        domainPalette: paletteId,
        domainBrightness: state.domainBrightness,
        domainContrast: state.domainContrast,
        domainSaturation: state.domainSaturation,
        domainLightnessCycles: state.domainLightnessCycles
    };

    const phase = Math.PI, phaseRe = Math.cos(phase), phaseIm = Math.sin(phase);
    for (let x = 0; x < w; x++) {
        const norm = x / Math.max(1, w - 1);
        const logMod = DOMAIN_COLOR_LOG_MAGNITUDE_MIN + norm * (DOMAIN_COLOR_LOG_MAGNITUDE_MAX - DOMAIN_COLOR_LOG_MAGNITUDE_MIN);
        const modVal = Math.exp(logMod);
        const rgb = domainColorForValue(modVal * phaseRe, modVal * phaseIm, tempState);

        for (let y = 0; y < h; y++) {
            const idx = (y * w + x) * 4;
            data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2]; data[idx + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);
    ctx.save();
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color') || 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, w, h);
    ctx.restore();
}

export function drawSurfacePaletteCircle(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2, rOuter = 130, rInner = 95;
    const palette = surfacePalettes.find(p => p.id === paletteId) || surfacePalettes.find(p => p.id === 'viridis');
    if (!palette) return;

    const colors = palette.colors.split(',').map(c => c.trim());
    const grad = ctx.createConicGradient(-Math.PI / 2, cx, cy);
    colors.forEach((color, i) => grad.addColorStop(i / (colors.length - 1), color));

    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.arc(cx, cy, rInner, Math.PI * 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    drawPaletteCircleAnnotations(ctx, cx, cy, rOuter, rInner);
}

export function drawSurfaceAmplitudeStrip(canvas, paletteId) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);

    const palette = surfacePalettes.find(p => p.id === paletteId) || surfacePalettes.find(p => p.id === 'viridis');
    if (!palette) return;

    const colors = palette.colors.split(',').map(c => c.trim());
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    colors.forEach((color, i) => grad.addColorStop(i / (colors.length - 1), color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

export function updateDomainPaletteCirclePanel() {
    const activePalette = domainPalettes.find(p => p.id === state.domainPalette) || domainPalettes[0];
    const title = $('domain_palette_circle_title');
    if (title) title.textContent = activePalette.name;
    drawDomainPaletteCircle($('domain_palette_circle_canvas'), state.domainPalette);
    drawAmplitudeStrip($('amplitude_strip_canvas'), state.domainPalette);
}

export function updateSurfacePaletteCirclePanel() {
    const activePalette = surfacePalettes.find(p => p.id === state.surfacePalette) || surfacePalettes.find(p => p.id === 'viridis');
    const title = $('real_plots_palette_circle_title');
    if (title && activePalette) title.textContent = activePalette.name;
    drawSurfacePaletteCircle($('real_plots_palette_circle_canvas'), state.surfacePalette);
    drawSurfaceAmplitudeStrip($('real_plots_amplitude_strip_canvas'), state.surfacePalette);
}
