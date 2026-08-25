import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMSCRIPTEN_VERSION = '4.0.12';
const GMP_VERSION = '6.3.0';
const MPFR_VERSION = '4.2.1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeRoot = join(root, 'native');
const cacheRoot = join(root, '.cache', 'native-toolchain');
const emsdkRoot = join(cacheRoot, `emsdk-${EMSCRIPTEN_VERSION}`);
const emcc = join(emsdkRoot, 'upstream', 'emscripten', process.platform === 'win32' ? 'emcc.bat' : 'emcc');
const emConfig = join(emsdkRoot, '.emscripten');
const output = join(nativeRoot, 'build', 'complex_engine.wasm');
const stamp = join(nativeRoot, 'build', '.source-hash');
const force = process.argv.includes('--force');

function sourceFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'build') files.push(...sourceFiles(path));
        } else if (['.c', '.h'].includes(extname(entry.name))) {
            files.push(path);
        }
    }
    return files.sort();
}

const sources = sourceFiles(nativeRoot);
const hash = createHash('sha256');
hash.update(`emscripten:${EMSCRIPTEN_VERSION}\ngmp:${GMP_VERSION}\nmpfr:${MPFR_VERSION}\nflags:-O3,-flto,-msimd128,-fno-fast-math\n`);
for (const source of sources) {
    hash.update(relative(root, source));
    hash.update('\0');
    hash.update(readFileSync(source));
}
const digest = hash.digest('hex');

if (!force && existsSync(output) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === digest) {
    console.log(`[wasm] ${relative(root, output)} is current.`);
    process.exit(0);
}

mkdirSync(cacheRoot, { recursive: true });
mkdirSync(dirname(output), { recursive: true });

if (!existsSync(join(emsdkRoot, 'emsdk.py'))) {
    const archive = join(cacheRoot, `emsdk-${EMSCRIPTEN_VERSION}.tar.gz`);
    const url = `https://github.com/emscripten-core/emsdk/archive/refs/tags/${EMSCRIPTEN_VERSION}.tar.gz`;
    console.log(`[wasm] Downloading pinned Emscripten ${EMSCRIPTEN_VERSION}...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to download Emscripten ${EMSCRIPTEN_VERSION}: HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    execFileSync('tar', ['-xzf', archive, '-C', cacheRoot], { stdio: 'inherit' });
}

if (!existsSync(emcc)) {
    console.log(`[wasm] Installing pinned Emscripten ${EMSCRIPTEN_VERSION} in the project cache...`);
    execFileSync(join(emsdkRoot, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk'), ['install', EMSCRIPTEN_VERSION], {
        cwd: emsdkRoot,
        stdio: 'inherit'
    });
}

if (!existsSync(emConfig)) {
    execFileSync(join(emsdkRoot, process.platform === 'win32' ? 'emsdk.bat' : 'emsdk'), ['activate', EMSCRIPTEN_VERSION], {
        cwd: emsdkRoot,
        stdio: 'inherit'
    });
}

const dependencyRoot = join(cacheRoot, 'precision-libs');
const dependencyPrefix = join(dependencyRoot, 'prefix');
const emscriptenBin = join(emsdkRoot, 'upstream', 'emscripten');
const buildEnvironment = {
    ...process.env,
    EM_CONFIG: emConfig,
    PATH: `${emscriptenBin}:${process.env.PATH || ''}`,
    CFLAGS: '-O3 -flto -fno-fast-math',
    MAKEFLAGS: '-j4'
};

async function downloadAndExtract(name, version, url) {
    const source = join(dependencyRoot, `${name}-${version}`);
    if (existsSync(join(source, 'configure'))) return source;
    mkdirSync(source, { recursive: true });
    const archive = join(dependencyRoot, `${name}-${version}.tar.xz`);
    console.log(`[wasm] Downloading pinned ${name.toUpperCase()} ${version}...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to download ${name.toUpperCase()} ${version}: HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    execFileSync('tar', ['-xJf', archive, '--strip-components=1', '-C', source], { stdio: 'inherit' });
    return source;
}

async function ensurePrecisionLibraries() {
    const gmpLibrary = join(dependencyPrefix, 'lib', 'libgmp.a');
    if (!existsSync(gmpLibrary)) {
        const source = await downloadAndExtract(
            'gmp', GMP_VERSION, `https://ftp.gnu.org/gnu/gmp/gmp-${GMP_VERSION}.tar.xz`
        );
        console.log(`[wasm] Building pinned GMP ${GMP_VERSION}...`);
        execFileSync(join(emscriptenBin, 'emconfigure'), [
            join(source, 'configure'), '--host=none', '--disable-shared', '--enable-static',
            '--disable-assembly', `--prefix=${dependencyPrefix}`
        ], { cwd: source, stdio: 'inherit', env: buildEnvironment });
        execFileSync('make', [], { cwd: source, stdio: 'inherit', env: buildEnvironment });
        execFileSync('make', ['install'], { cwd: source, stdio: 'inherit', env: buildEnvironment });
    }

    const mpfrLibrary = join(dependencyPrefix, 'lib', 'libmpfr.a');
    if (!existsSync(mpfrLibrary)) {
        const source = await downloadAndExtract(
            'mpfr', MPFR_VERSION, `https://ftp.gnu.org/gnu/mpfr/mpfr-${MPFR_VERSION}.tar.xz`
        );
        console.log(`[wasm] Building pinned MPFR ${MPFR_VERSION}...`);
        execFileSync(join(emscriptenBin, 'emconfigure'), [
            join(source, 'configure'), '--host=none', '--disable-shared', '--enable-static',
            `--with-gmp=${dependencyPrefix}`, `--prefix=${dependencyPrefix}`
        ], { cwd: source, stdio: 'inherit', env: buildEnvironment });
        execFileSync('make', [], { cwd: source, stdio: 'inherit', env: buildEnvironment });
        execFileSync('make', ['install'], { cwd: source, stdio: 'inherit', env: buildEnvironment });
    }
}

await ensurePrecisionLibraries();

const exported = [
    '_ce_alloc', '_ce_free', '_ce_abi_version', '_ce_prepare_map_config',
    '_ce_evaluate_points', '_ce_evaluate_algebraic_points',
    '_ce_evaluate_sheets', '_ce_continuation_sheets',
    '_ce_evaluate_dynamic',
    '_ce_evaluate_expression', '_ce_generate_discrete_values',
    '_ce_compute_taylor_coefficients',
    '_ce_generate_input_shape', '_ce_generate_radial_steps',
    '_ce_generate_viewport_grid_pixels',
    '_ce_build_planar_line', '_ce_build_planar_lines', '_ce_build_planar_polyline',
    '_ce_generate_transform_signal', '_ce_compute_spectrum', '_ce_build_laplace_winding',
    '_ce_generate_laplace_analysis',
    '_ce_build_laplace_surface', '_ce_build_real_surface', '_ce_build_image_mesh',
    '_ce_render_map_contour', '_ce_render_real_contour',
    '_ce_build_image_mesh_precise', '_ce_build_grid_fold',
    '_ce_build_sphere_lines', '_ce_project_sphere_points', '_ce_build_sphere_probe',
    '_ce_build_riemann_sphere_targets', '_ce_interpolate_geometry',
    '_ce_build_riemann_sphere_positions', '_ce_build_riemann_probe', '_ce_build_fold_preimage_markers',
    '_ce_create_domain_render_context', '_ce_destroy_domain_render_context', '_ce_render_domain_tile',
    '_ce_project_precise_pixels',
    '_ce_project_precise_pixels_to_canvas', '_ce_project_values_to_precise',
    '_ce_trace_streamlines', '_ce_build_vector_field', '_ce_build_tissot',
    '_ce_find_preimages', '_ce_find_polynomial_roots', '_ce_analyze_contour', '_ce_estimate_residue',
    '_ce_generate_contour_points', '_ce_classify_contour_singularities'
];
const compileArgs = [
    ...sources.filter(path => extname(path) === '.c'),
    '-I', join(nativeRoot, 'include'),
    '-I', join(dependencyPrefix, 'include'),
    '-std=c11', '-O3', '-flto', '-msimd128', '-fno-fast-math', '-Wall', '-Wextra', '-Werror',
    '-sSTANDALONE_WASM=1', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=16777216', '-sSTACK_SIZE=1048576',
    join(dependencyPrefix, 'lib', 'libmpfr.a'), join(dependencyPrefix, 'lib', 'libgmp.a'),
    '-sMALLOC=emmalloc', `-sEXPORTED_FUNCTIONS=${JSON.stringify(exported)}`,
    '--no-entry', '-o', output
];

console.log(`[wasm] Building ${relative(root, output)}...`);
execFileSync(emcc, compileArgs, {
    cwd: root,
    stdio: 'inherit',
    env: buildEnvironment
});
writeFileSync(stamp, `${digest}\n`);
console.log('[wasm] Native engine build complete.');
