/** @jsxImportSource preact */

const GUIDES = {
    domain: {
        eyebrow: 'Domain Coloring Guide',
        titleId: 'domain_palette_circle_title',
        title: 'Analytic Base',
        closeId: 'close_domain_palette_circle_btn',
        closeLabel: 'Close Domain Coloring Guide',
        intro: 'Shows how complex phase angles map to colors (ring) and how modulus magnitude maps to lightness/shading.',
        canvasId: 'domain_palette_circle_canvas',
        stripId: 'amplitude_strip_canvas',
        stripTitle: 'Modulus (Amplitude) vs. Lightness',
        stripCopy: 'Shows current magnitude lightness shading on a representative active-palette hue (from |z| = 0 to 10¹², logarithmic).',
        ticks: [['start', '|z| = 0'], ['near-start', '1'], ['quarter', '10³'], ['middle', '10⁶'], ['end', '|z| = 10¹²']]
    },
    real: {
        eyebrow: 'Real Plots Color Guide',
        titleId: 'real_plots_palette_circle_title',
        title: 'Viridis Scientific',
        closeId: 'close_real_plots_palette_circle_btn',
        closeLabel: 'Close Real Plots Color Guide',
        intro: 'Shows how complex phase angles or surface heights map to the selected color palette.',
        canvasId: 'real_plots_palette_circle_canvas',
        stripId: 'real_plots_amplitude_strip_canvas',
        stripTitle: 'Surface Height (Value) vs. Mapping',
        stripCopy: 'Shows how surface heights map to the gradient when color is mapped to "Height (Value)".',
        ticks: [['start', 'Low'], ['middle', 'Middle'], ['end', 'High']]
    }
};

export function PaletteGuide({ type }) {
    const guide = GUIDES[type];
    return (
        <>
            <div class="dynamic-studio-header">
                <div class="dynamic-studio-identity">
                    <span class="dynamic-section-eyebrow">{guide.eyebrow}</span>
                    <strong id={guide.titleId}>{guide.title}</strong>
                </div>
                <div class="dynamic-studio-actions">
                    <button id={guide.closeId} type="button" class="dynamic-studio-action dynamic-studio-close"
                        aria-label={guide.closeLabel}>Close</button>
                </div>
            </div>
            <div class="dynamic-intro palette-guide-intro">
                <div>
                    <div class="dynamic-intro-title">Color Guide Wheel</div>
                    <div class="dynamic-intro-copy">{guide.intro}</div>
                </div>
            </div>
            <div class="color-wheel-canvas-container palette-guide-wheel">
                <canvas id={guide.canvasId} width="360" height="360" class="palette-guide-wheel-canvas" />
            </div>
            <div class="amplitude-strip-container palette-guide-strip">
                <div class="dynamic-intro-title palette-guide-strip-title">{guide.stripTitle}</div>
                <div class="dynamic-intro-copy palette-guide-strip-copy">{guide.stripCopy}</div>
                <div class="palette-guide-scale">
                    <canvas id={guide.stripId} width="320" height="24" class="palette-guide-scale-canvas" />
                    <div class="palette-guide-ticks">
                        {guide.ticks.map(([position, label]) => (
                            <span key={position} class={`palette-guide-tick is-${position}`}>{label}</span>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
