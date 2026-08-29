const PALETTE_LUT_SIZE = 1024;

export const SURFACE_PALETTES = Object.freeze([
    {
        id: 'sunset',
        name: 'Sunset Glow',
        colors: '#12001f, #3c096c, #9d174d, #f97316, #fef3c7'
    },
    {
        id: 'ocean',
        name: 'Ocean Breeze',
        colors: '#001b2e, #005f73, #0a9396, #94d2bd, #e9d8a6'
    },
    {
        id: 'cyberpunk',
        name: 'Cyberpunk Glow',
        colors: '#11001c, #3a0ca3, #f72585, #4cc9f0, #faff00'
    },
    {
        id: 'copper',
        name: 'Classic Copper',
        colors: '#170f0a, #5c2e12, #b85c24, #f6aa52, #ffecd1'
    },
    {
        id: 'forest',
        name: 'Forest Mist',
        colors: '#03190e, #0b3d20, #2d6a4f, #95d5b2, #fff3b0'
    },
    {
        id: 'viridis',
        name: 'Viridis Scientific',
        colors: '#440154, #3b528b, #21908d, #5dc963, #fde725'
    }
]);

function parseHexColor(value) {
    const source = String(value ?? '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(source)) {
        throw new Error(`Surface palette color must be a six-digit hex value: ${source}.`);
    }
    return Number.parseInt(source.slice(1), 16);
}

function hexChannel(hex, shift) {
    return ((hex >> shift) & 255) / 255;
}

function writeInterpolatedHex(target, offset, a, b, t) {
    const ar = hexChannel(a, 16);
    const ag = hexChannel(a, 8);
    const ab = hexChannel(a, 0);
    target[offset] = ar + (hexChannel(b, 16) - ar) * t;
    target[offset + 1] = ag + (hexChannel(b, 8) - ag) * t;
    target[offset + 2] = ab + (hexChannel(b, 0) - ab) * t;
}

function createPaletteLut(colors) {
    const stops = colors.split(',').map(parseHexColor);
    if (stops.length < 2) throw new Error('Surface palettes require at least two color stops.');
    const lut = new Float32Array(PALETTE_LUT_SIZE * 3);
    const lastSegment = stops.length - 1;
    for (let index = 0, offset = 0; index < PALETTE_LUT_SIZE; index += 1, offset += 3) {
        const scaled = index / (PALETTE_LUT_SIZE - 1) * lastSegment;
        const segment = Math.min(lastSegment - 1, scaled | 0);
        writeInterpolatedHex(lut, offset, stops[segment], stops[segment + 1], scaled - segment);
    }
    return lut;
}

const PALETTE_LUTS = Object.freeze(Object.fromEntries(
    SURFACE_PALETTES.map(palette => [palette.id, createPaletteLut(palette.colors)])
));

export function paletteLutFor(name, options = null) {
    const basePalette = PALETTE_LUTS[name];
    if (!basePalette) throw new Error(`Unsupported surface palette: ${name}.`);
    if (!options) return basePalette;

    const brightness = Number.isFinite(options.brightness) ? Math.max(0.1, Math.min(3.0, options.brightness)) : 1.0;
    const contrast = Number.isFinite(options.contrast) ? Math.max(0.1, Math.min(3.0, options.contrast)) : 1.0;
    const saturation = Number.isFinite(options.saturation) ? Math.max(0.0, Math.min(3.0, options.saturation)) : 1.0;

    if (brightness === 1.0 && contrast === 1.0 && saturation === 1.0) {
        return basePalette;
    }

    const lut = new Float32Array(basePalette.length);
    for (let i = 0; i < basePalette.length; i += 3) {
        let r = basePalette[i];
        let g = basePalette[i + 1];
        let b = basePalette[i + 2];

        if (saturation !== 1.0) {
            const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            r = gray + (r - gray) * saturation;
            g = gray + (g - gray) * saturation;
            b = gray + (b - gray) * saturation;
        }

        if (contrast !== 1.0) {
            r = (r - 0.5) * contrast + 0.5;
            g = (g - 0.5) * contrast + 0.5;
            b = (b - 0.5) * contrast + 0.5;
        }

        if (brightness !== 1.0) {
            r *= brightness;
            g *= brightness;
            b *= brightness;
        }

        lut[i] = Math.max(0, Math.min(1, r));
        lut[i + 1] = Math.max(0, Math.min(1, g));
        lut[i + 2] = Math.max(0, Math.min(1, b));
    }
    return lut;
}

export function paletteColor(lut, ratio, target, offset) {
    const normalized = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const index = Math.round(normalized * (PALETTE_LUT_SIZE - 1)) * 3;
    target[offset] = lut[index];
    target[offset + 1] = lut[index + 1];
    target[offset + 2] = lut[index + 2];
}

export { PALETTE_LUT_SIZE };
