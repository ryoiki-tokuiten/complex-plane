const RAW_DOMAIN_PALETTES = [
    {
        id: 'analytic-base',
        shaderId: 0,
        name: 'Analytic Base',
        stops: [
            [173, 31, 31],
            [153, 153, 28],
            [28, 153, 28],
            [28, 153, 153],
            [34, 34, 195],
            [173, 31, 173],
            [173, 31, 31]
        ],
        key: [
            { label: 'Red', color: 'rgb(173, 31, 31)', angle: '0° (Positive Real)' },
            { label: 'Green', color: 'rgb(28, 153, 28)', angle: '90° (Positive Imaginary)' },
            { label: 'Cyan', color: 'rgb(28, 153, 153)', angle: '180° (Negative Real)' },
            { label: 'Blue', color: 'rgb(34, 34, 195)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'arctic-frost',
        shaderId: 4,
        name: 'Arctic Frost',
        stops: [
            [15, 23, 42],
            [30, 41, 59],
            [59, 130, 246],
            [147, 197, 253],
            [59, 130, 246],
            [30, 41, 59],
            [15, 23, 42]
        ],
        key: [
            { label: 'Deep Slate', color: 'rgb(15, 23, 42)', angle: '0° (Positive Real)' },
            { label: 'Steel Blue', color: 'rgb(30, 41, 59)', angle: '90° (Positive Imaginary)' },
            { label: 'Ice Blue', color: 'rgb(147, 197, 253)', angle: '180° (Negative Real)' },
            { label: 'Frost Blue', color: 'rgb(59, 130, 246)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'calming',
        shaderId: 11,
        name: 'Calming',
        stops: [
            [217, 197, 193],
            [196, 139, 128],
            [202, 147, 133],
            [235, 220, 210],
            [155, 113, 105],
            [149, 106, 99],
            [217, 197, 193]
        ],
        key: [
            { label: 'Cream', color: 'rgb(235, 220, 210)', angle: '0° (Positive Real)' },
            { label: 'Caramel', color: 'rgb(115, 60, 52)', angle: '90° (Positive Imaginary)' },
            { label: 'Mahogany', color: 'rgb(217, 197, 193)', angle: '180° (Negative Real)' },
            { label: 'Copper', color: 'rgb(185, 110, 95)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'three-b1b-newton-deep',
        shaderId: 21,
        name: '3Blue1Brown Newton Deep',
        stops: [
            [68, 1, 84],
            [59, 82, 139],
            [33, 144, 140],
            [93, 201, 99],
            [41, 171, 202],
            [68, 1, 84]
        ],
        key: [
            { label: 'Purple', color: 'rgb(68, 1, 84)', angle: '0° (Positive Real)' },
            { label: 'Blue', color: 'rgb(59, 82, 139)', angle: '72°' },
            { label: 'Teal', color: 'rgb(33, 144, 140)', angle: '144°' },
            { label: 'Green', color: 'rgb(93, 201, 99)', angle: '216°' },
            { label: 'Cyan', color: 'rgb(41, 171, 202)', angle: '288°' }
        ]
    },
    {
        id: 'mandelbrot',
        shaderId: 14,
        name: 'Mandelbrot',
        stops: [
            [0, 7, 100],
            [19, 86, 189],
            [133, 192, 237],
            [247, 249, 221],
            [255, 172, 0],
            [10, 7, 0],
            [0, 7, 100]
        ],
        key: [
            { label: 'Dark Blue', color: 'rgb(0, 7, 100)', angle: '0° (Positive Real)' },
            { label: 'Cyan', color: 'rgb(133, 192, 237)', angle: '90° (Positive Imaginary)' },
            { label: 'Yellow', color: 'rgb(255, 172, 0)', angle: '180° (Negative Real)' },
            { label: 'Black', color: 'rgb(10, 7, 0)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'lava',
        shaderId: 15,
        name: 'Lava',
        stops: [
            [0, 0, 0],
            [80, 0, 0],
            [255, 160, 0],
            [255, 255, 255],
            [255, 160, 0],
            [80, 0, 0],
            [0, 0, 0]
        ],
        key: [
            { label: 'Black', color: 'rgb(0, 0, 0)', angle: '0° (Positive Real)' },
            { label: 'Dark Red', color: 'rgb(80, 0, 0)', angle: '90° (Positive Imaginary)' },
            { label: 'Orange', color: 'rgb(255, 160, 0)', angle: '180° (Negative Real)' },
            { label: 'White', color: 'rgb(255, 255, 255)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'fall',
        shaderId: 16,
        name: 'Fall',
        stops: [
            [25, 25, 25],
            [128, 0, 0],
            [255, 69, 0],
            [255, 140, 0],
            [255, 215, 0],
            [255, 239, 184],
            [25, 25, 25]
        ],
        key: [
            { label: 'Dark Grey', color: 'rgb(25, 25, 25)', angle: '0° (Positive Real)' },
            { label: 'Burnt Orange', color: 'rgb(255, 69, 0)', angle: '90° (Positive Imaginary)' },
            { label: 'Gold', color: 'rgb(255, 215, 0)', angle: '180° (Negative Real)' },
            { label: 'Pale Yellow', color: 'rgb(255, 239, 184)', angle: '-90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'jewellery',
        shaderId: 20,
        name: 'Jewellery',
        stops: [
            [0, 0, 51],
            [0, 21, 170],
            [13, 115, 142],
            [204, 204, 255],
            [255, 0, 66],
            [123, 198, 255],
            [0, 0, 51]
        ],
        key: [
            { label: 'Deep Blue', color: 'rgb(0, 0, 51)', angle: '0° (Positive Real)' },
            { label: 'Teal', color: 'rgb(13, 115, 142)', angle: '90° (Positive Imaginary)' },
            { label: 'Rose', color: 'rgb(255, 0, 66)', angle: '180° (Negative Real)' },
            { label: 'Light Blue', color: 'rgb(123, 198, 255)', angle: '-90° (Negative Imaginary)' }
        ]
    }
];

function rgbCss(stop) {
    return `rgb(${stop[0]}, ${stop[1]}, ${stop[2]})`;
}

function unitStop(stop) {
    return Object.freeze(stop.map(channel => channel / 255));
}

function freezePalette(palette) {
    const stops = Object.freeze(palette.stops.map(stop => Object.freeze([...stop])));
    const stopsUnit = Object.freeze(stops.map(unitStop));
    return Object.freeze({
        ...palette,
        stops,
        stopsUnit,
        colors: stops.map(rgbCss).join(', '),
        key: Object.freeze(palette.key.map(item => Object.freeze({ ...item })))
    });
}

export const DOMAIN_PALETTES = Object.freeze(RAW_DOMAIN_PALETTES.map(freezePalette));

export const domainPalettes = Object.freeze(DOMAIN_PALETTES.map(palette => Object.freeze({
    id: palette.id,
    name: palette.name,
    colors: palette.colors,
    key: palette.key
})));

export const DOMAIN_PALETTE_IDS = Object.freeze(Object.fromEntries(
    DOMAIN_PALETTES.map(palette => [palette.id, palette.shaderId])
));

export const DEFAULT_DOMAIN_PALETTE_ID = 'arctic-frost';
export const FALLBACK_DOMAIN_PALETTE_SHADER_ID = DOMAIN_PALETTE_IDS[DEFAULT_DOMAIN_PALETTE_ID];

export function getDomainPalette(id) {
    return DOMAIN_PALETTES.find(palette => palette.id === id) ||
        DOMAIN_PALETTES.find(palette => palette.id === DEFAULT_DOMAIN_PALETTE_ID) ||
        DOMAIN_PALETTES[0];
}

export function getDomainPaletteStops(id) {
    return getDomainPalette(id).stopsUnit;
}

export function getDomainPaletteShaderId(id) {
    return DOMAIN_PALETTE_IDS[id] ?? FALLBACK_DOMAIN_PALETTE_SHADER_ID;
}

function glslFloat(value) {
    return Number(value).toFixed(6);
}

function glslVec3(stop) {
    return `vec3(${stop.map(glslFloat).join(', ')})`;
}

function glslInterpolator(stopCount) {
    const maxIndex = stopCount - 1;
    const lines = [
        `vec3 interpolatePalette${stopCount}(${Array.from({ length: stopCount }, (_, index) => `vec3 c${index}`).join(', ')}, float h) {`,
        `  float val = fract(h) * ${glslFloat(maxIndex)};`
    ];
    for (let index = 0; index < maxIndex - 1; index += 1) {
        const prefix = index === 0 ? 'if' : 'else if';
        lines.push(`  ${prefix} (val < ${glslFloat(index + 1)}) return mix(c${index}, c${index + 1}, val - ${glslFloat(index)});`);
    }
    lines.push(`  return mix(c${maxIndex - 1}, c${maxIndex}, val - ${glslFloat(maxIndex - 1)});`);
    lines.push('}');
    return lines.join('\n');
}

function glslPaletteCall(palette) {
    return `interpolatePalette${palette.stopsUnit.length}(${palette.stopsUnit.map(glslVec3).join(', ')}, hue)`;
}

export function createDomainPaletteGlslSource(functionName = 'getPaletteColor') {
    const stopCounts = [...new Set(DOMAIN_PALETTES.map(palette => palette.stopsUnit.length))].sort((a, b) => a - b);
    const branches = DOMAIN_PALETTES.map((palette, index) => {
        const prefix = index === 0 ? 'if' : 'else if';
        return `  ${prefix} (paletteId == ${palette.shaderId}) return ${glslPaletteCall(palette)};`;
    });
    const fallback = DOMAIN_PALETTES.find(palette => palette.shaderId === FALLBACK_DOMAIN_PALETTE_SHADER_ID) ||
        DOMAIN_PALETTES[0];

    return [
        ...stopCounts.map(glslInterpolator),
        `vec3 ${functionName}(int paletteId, float h) {`,
        '  float hue = fract(h);',
        ...branches,
        `  return ${glslPaletteCall(fallback)};`,
        '}'
    ].join('\n\n');
}
