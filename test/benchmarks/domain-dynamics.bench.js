import assert from 'node:assert/strict';
import { runBenchmark } from './utils.js';
import { state } from '../../js/store/state.js';
import { nativeMapOptions, compileDomainProgram } from '../../js/native/complex-engine.js';

// This benchmark measures CPU reference work shared by GPU samples.
// It does not measure WebGL pixel throughput.
export async function runDomainDynamicsBenchmarks() {
    const snapshot = {
        ...nativeMapOptions(state, { functionKey: 'cos', chainingEnabled: true, chainMode: 'recursion', chainCount: 900 }),
        orbitColoringMode: 'value', paletteStops: [[1,0,0],[0,1,0],[1,0,0]],
        style: { brightness: 1, contrast: 1, saturation: 1, lightnessCycles: 1 },
        viewport: { width: 1024, height: 768, centerRe: '0.3', centerIm: '0.2', xSpan: '0.01', ySpan: '0.0075', precisionBits: 256 }
    };
    await runBenchmark('Domain: compile shared expression', null, () => {
        const p = compileDomainProgram(snapshot);
        try { return p.nodes.length; } finally { p.dispose(); }
    });
    const p = compileDomainProgram(snapshot);
    try {
        await runBenchmark('Domain: 32 bounded reference iterations (shared by all pixels)', null, () => {
            const r = p.reference({ x: 511.5, y: 383.5, precision: 256, terms: 32 });
            try {
                const data = r.next(32);
                assert.ok(data.length > 0);
                return data;
            } finally { r.dispose(); }
        });
    } finally { p.dispose(); }
}
