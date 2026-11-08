export const DEFAULT_DOMAIN_PALETTE = 'arctic-fox';

const RAW_DOMAIN_PALETTES = [
    {
        id: 'arctic-fox',
        shaderId: 15,
        name: 'Arctic Fox',
        desc: 'Glacial cyan, polar slate, frost ivory, twilight amber',
        hexStops: [
            '#0D2430',
            '#1E6078',
            '#7AD1E6',
            '#F4F9FC',
            '#E66C4C',
            '#243E52'
        ],
        stops: [
            [13, 36, 48],
            [30, 96, 120],
            [122, 209, 230],
            [244, 249, 252],
            [230, 108, 76],
            [36, 62, 82],
            [13, 36, 48]
        ],
        key: [
            { label: 'Frost Ivory', hex: '#F4F9FC', color: 'rgb(244, 249, 252)', angle: '0° (Positive Real)' },
            { label: 'Twilight Amber', hex: '#E66C4C', color: 'rgb(230, 108, 76)', angle: '60° / 90° (Positive Imaginary)' },
            { label: 'Polar Slate', hex: '#243E52', color: 'rgb(36, 62, 82)', angle: '120° (Upper-Left Phase)' },
            { label: 'Deep Polar Slate', hex: '#0D2430', color: 'rgb(13, 36, 48)', angle: '180° (Negative Real)' },
            { label: 'Glacial Teal', hex: '#1E6078', color: 'rgb(30, 96, 120)', angle: '-120° (Lower-Left Phase)' },
            { label: 'Glacial Cyan', hex: '#7AD1E6', color: 'rgb(122, 209, 230)', angle: '-60° / -90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'silent-colors',
        shaderId: 20,
        name: 'Silent Colors',
        desc: 'Muted sage, warm stone, dusty clay, mist charcoal',
        hexStops: [
            '#26302B',
            '#5E7268',
            '#C6CEBE',
            '#F0ECE1',
            '#C87D65',
            '#3D4641'
        ],
        stops: [
            [38, 48, 43],
            [94, 114, 104],
            [198, 206, 190],
            [240, 236, 225],
            [200, 125, 101],
            [61, 70, 65],
            [38, 48, 43]
        ],
        key: [
            { label: 'Warm Stone', hex: '#F0ECE1', color: 'rgb(240, 236, 225)', angle: '0° (Positive Real)' },
            { label: 'Dusty Clay', hex: '#C87D65', color: 'rgb(200, 125, 101)', angle: '60° / 90° (Positive Imaginary)' },
            { label: 'Mist Charcoal', hex: '#3D4641', color: 'rgb(61, 70, 65)', angle: '120° (Upper-Left Phase)' },
            { label: 'Deep Pine Charcoal', hex: '#26302B', color: 'rgb(38, 48, 43)', angle: '180° (Negative Real)' },
            { label: 'Muted Sage', hex: '#5E7268', color: 'rgb(94, 114, 104)', angle: '-120° (Lower-Left Phase)' },
            { label: 'Pale Sage Mist', hex: '#C6CEBE', color: 'rgb(198, 206, 190)', angle: '-60° / -90° (Negative Imaginary)' }
        ]
    },
    {
        id: 'analytic-base',
        shaderId: 0,
        name: 'Analytic Base',
        desc: 'Classical HSV phase wheel — crimson, emerald, cyan, cobalt',
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
        desc: 'Deep slate, steel blue, ice blue, frost blue',
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
        desc: 'Warm cream, caramel, mahogany, soft copper',
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
        desc: 'Deep violet, indigo, teal, emerald, bright cyan',
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
        desc: 'Ultramarine, sky cyan, ivory, solar gold, obsidian',
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
        id: 'fall',
        shaderId: 16,
        name: 'Fall',
        desc: 'Charcoal, crimson, burnt orange, harvest gold',
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
    }
];

function rgbCss(stop) {
    return `rgb(${stop[0]}, ${stop[1]}, ${stop[2]})`;
}

function rgbToHex(stop) {
    return `#${stop.map(channel => Number(channel).toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

function unitStop(stop) {
    return Object.freeze(stop.map(channel => channel / 255));
}

function freezePalette(palette) {
    const stops = Object.freeze(palette.stops.map(stop => Object.freeze([...stop])));
    const stopsUnit = Object.freeze(stops.map(unitStop));
    const uniqueRgbStops = stops.length > 1 &&
        stops[0][0] === stops[stops.length - 1][0] &&
        stops[0][1] === stops[stops.length - 1][1] &&
        stops[0][2] === stops[stops.length - 1][2]
        ? stops.slice(0, -1)
        : stops;
    const hexStops = Object.freeze(
        Array.isArray(palette.hexStops)
            ? [...palette.hexStops]
            : uniqueRgbStops.map(rgbToHex)
    );
    return Object.freeze({
        ...palette,
        desc: palette.desc || '',
        hexStops,
        stops,
        stopsUnit,
        colors: stops.map(rgbCss).join(', '),
        key: Object.freeze(palette.key.map(item => Object.freeze({ ...item })))
    });
}

const DOMAIN_PALETTES = Object.freeze(RAW_DOMAIN_PALETTES.map(freezePalette));

export const domainPalettes = Object.freeze(DOMAIN_PALETTES.map(palette => Object.freeze({
    id: palette.id,
    name: palette.name,
    desc: palette.desc,
    hexStops: palette.hexStops,
    colors: palette.colors,
    key: palette.key
})));

export const DOMAIN_PALETTE_IDS = Object.freeze(Object.fromEntries(
    DOMAIN_PALETTES.map(palette => [palette.id, palette.shaderId])
));

function getDomainPalette(id) {
    const palette = DOMAIN_PALETTES.find(candidate => candidate.id === id);
    if (!palette) throw new Error(`Unknown domain palette: ${id}`);
    return palette;
}

export function getDomainPaletteStops(id) {
    return getDomainPalette(id).stopsUnit;
}

export function getDomainPaletteShaderId(id) {
    const shaderId = DOMAIN_PALETTE_IDS[id];
    if (shaderId === undefined) throw new Error(`Unknown domain palette: ${id}`);
    return shaderId;
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
    return [
        ...stopCounts.map(glslInterpolator),
        `vec3 ${functionName}(int paletteId, float h) {`,
        '  float hue = fract(h);',
        ...branches,
        '  return vec3(1.0, 0.0, 1.0);',
        '}'
    ].join('\n\n');
}
