// We are now using shared primitives from canvas-primitives.js
import { drawArrowHead } from './canvas-primitives.js';

/**
 * Draw final integral result for split panel (smaller, less emphasis)
 */
export function drawIntegralResultSplit(ctx, windingData, params) {
    const integral = windingData.integral;
    const resultCanvas = {
        x: params.origin.x + integral.real * params.scale.x,
        y: params.origin.y - integral.imag * params.scale.y
    };
    
    // Glow
    const glowGradient = ctx.createRadialGradient(resultCanvas.x, resultCanvas.y, 0, resultCanvas.x, resultCanvas.y, 25);
    glowGradient.addColorStop(0, 'rgba(100, 255, 150, 0.3)');
    glowGradient.addColorStop(1, 'rgba(100, 255, 150, 0)');
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 25, 0, 2 * Math.PI);
    ctx.fill();
    
    // Result point
    const pointGradient = ctx.createRadialGradient(resultCanvas.x, resultCanvas.y, 0, resultCanvas.x, resultCanvas.y, 10);
    pointGradient.addColorStop(0, 'rgba(220, 255, 220, 1)');
    pointGradient.addColorStop(0.6, 'rgba(100, 255, 150, 1)');
    pointGradient.addColorStop(1, 'rgba(50, 200, 100, 1)');
    
    ctx.fillStyle = pointGradient;
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 10, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 1)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(resultCanvas.x, resultCanvas.y, 10, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Label
    const magnitude = Math.sqrt(integral.real * integral.real + integral.imag * integral.imag);
    
    ctx.fillStyle = 'rgba(150, 255, 180, 1)';
    ctx.font = 'bold 11px "SF Pro Display", sans-serif';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 3;
    ctx.fillText('F(s)', resultCanvas.x + 14, resultCanvas.y - 5);
    ctx.shadowBlur = 0;
    
    ctx.fillStyle = 'rgba(200, 255, 220, 0.95)';
    ctx.font = '10px "SF Mono", monospace';
    ctx.fillText(`= ${magnitude.toFixed(3)}`, resultCanvas.x + 14, resultCanvas.y + 8);
}

/**
 * Draw exponential spiral path (for top panel) and vectors
 */
export function drawExponentialPath(ctx, expData, params) {
    const points = expData.points;
    if (points.length < 2) return;
    
    // Draw spiral with gradient coloring
    for (let i = 1; i < points.length; i++) {
        const pt0 = points[i - 1];
        const pt1 = points[i];
        
        const canvas0 = {
            x: params.origin.x + pt0.real * params.scale.x,
            y: params.origin.y - pt0.imag * params.scale.y
        };
        const canvas1 = {
            x: params.origin.x + pt1.real * params.scale.x,
            y: params.origin.y - pt1.imag * params.scale.y
        };
        
        const progress = i / points.length;
        const hue = 180 + progress * 60; // Cyan to blue
        const alpha = 0.4 + progress * 0.4;
        
        ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(canvas0.x, canvas0.y);
        ctx.lineTo(canvas1.x, canvas1.y);
        ctx.stroke();
    }
    
    // Highlight current segment if animating
    if (points.length > 1 && expData.animTime < 1.0) {
        const lastIdx = points.length - 1;
        const pt0 = points[lastIdx - 1];
        const pt1 = points[lastIdx];
        
        const canvas0 = {
            x: params.origin.x + pt0.real * params.scale.x,
            y: params.origin.y - pt0.imag * params.scale.y
        };
        const canvas1 = {
            x: params.origin.x + pt1.real * params.scale.x,
            y: params.origin.y - pt1.imag * params.scale.y
        };
        
        ctx.strokeStyle = 'rgba(255, 230, 100, 1)';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255, 200, 50, 0.6)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(canvas0.x, canvas0.y);
        ctx.lineTo(canvas1.x, canvas1.y);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }

    // Vectors
    const originX = params.origin.x;
    const originY = params.origin.y;
    const numVectors = Math.min(8, Math.max(4, Math.floor(points.length / 25)));
    const step = Math.floor(points.length / numVectors);
    
    for (let i = 0; i < points.length; i += step) {
        const pt = points[i];
        const canvasX = params.origin.x + pt.real * params.scale.x;
        const canvasY = params.origin.y - pt.imag * params.scale.y;
        
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(originX, originY);
        ctx.lineTo(canvasX, canvasY);
        ctx.stroke();
        ctx.setLineDash([]);
        
        const angle = Math.atan2(canvasY - originY, canvasX - originX);
        drawArrowHead(ctx, canvasX, canvasY, angle, 6, 'rgba(100, 200, 255, 0.5)');
        
        ctx.fillStyle = 'rgba(150, 220, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 2.5, 0, 2 * Math.PI);
        ctx.fill();
        
        if (i % (step * 2) === 0 && pt.t > 0) {
            ctx.fillStyle = 'rgba(180, 220, 255, 0.9)';
            ctx.font = '9px "SF Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`t=${pt.t.toFixed(1)}`, canvasX, canvasY - 10);
        }
    }
}
