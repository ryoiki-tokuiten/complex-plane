import { expect, test } from '@playwright/test';

test('GPU domain-dynamics helpers match the CPU contract fixtures', async ({ page }) => {
    await page.goto('./');
    await page.waitForFunction(() => window.__state && document.getElementById('z_plane_canvas')?.width > 0);

    const result = await page.evaluate(async () => {
        const moduleUrl = new URL('js/constants/domain-dynamics.js', location.href).href;
        const {
            DOMAIN_DYNAMICS_GLSL,
            DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
            domainDynamicsLogMagnitude,
            domainDynamicsSmoothIteration,
            isFiniteDomainDynamicsValue
        } = await import(moduleUrl);

        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
        if (!gl) return { supported: false };

        const compile = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                throw new Error(gl.getShaderInfoLog(shader) || 'shader compilation failed');
            }
            return shader;
        };

        const vertexShader = compile(gl.VERTEX_SHADER, `
            attribute vec2 a_position;
            void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
        `);
        const fragmentShader = compile(gl.FRAGMENT_SHADER, `
            #ifdef GL_FRAGMENT_PRECISION_HIGH
            precision highp float;
            #else
            precision mediump float;
            #endif
            const float LOG_TWO = 0.6931471805599453;
            bool isFiniteFloatCompat(float value) {
                return (value == value) && abs(value) < 1.0e30;
            }
            ${DOMAIN_DYNAMICS_GLSL}
            uniform vec4 u_fixture;
            uniform float u_mode;
            void main() {
                vec2 value = u_fixture.xy;
                bool escaped = domainDynamicsEscapes(value);
                float logMagnitude = domainDynamicsLogMagnitude(value);
                float smooth = domainDynamicsSmoothIteration(
                    u_fixture.z,
                    u_fixture.w,
                    value
                );
                int chainIterations = 0;
                for (int i = 0; i < DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH; i++) {
                    if (float(i) >= u_fixture.w) break;
                    chainIterations++;
                }
                gl_FragColor = vec4(
                    escaped ? 1.0 : 0.0,
                    clamp(logMagnitude / 100.0, 0.0, 1.0),
                    clamp(smooth / max(u_fixture.w, 1.0), 0.0, 1.0),
                    u_mode > 0.5
                        ? float(chainIterations) / float(DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH)
                        : (isFiniteDomainDynamicsValue(value) ? 1.0 : 0.0)
                );
            }
        `);
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'shader link failed');
        }

        const positions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positions);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.useProgram(program);
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
        const fixtureLocation = gl.getUniformLocation(program, 'u_fixture');
        const modeLocation = gl.getUniformLocation(program, 'u_mode');

        const fixtures = [
            [0, 0, 0, 17, false],
            [3, 4, 2, 17, false],
            [10000, 0, 3, 17, false],
            [10001, 0, 3, 17, true],
            [1e5, 1e5, 4, 17, true],
            [1e30, 0, 5, 17, true],
            [-1e30, 0, 6, 17, true]
        ];
        const pixels = new Uint8Array(4);
        const values = [];

        for (const [re, im, iteration, chainCount, expectedEscaped] of fixtures) {
            gl.uniform1f(modeLocation, 0);
            gl.uniform4f(fixtureLocation, re, im, iteration, chainCount);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

            values.push({
                expectedEscaped,
                gpuEscaped: pixels[0] >= 128,
                cpuFinite: isFiniteDomainDynamicsValue(re, im),
                gpuFinite: pixels[3] >= 128,
                cpuLogMagnitude: domainDynamicsLogMagnitude(re, im),
                gpuLogMagnitude: pixels[1] / 255 * 100,
                cpuSmoothIteration: domainDynamicsSmoothIteration(
                    iteration,
                    chainCount,
                    re,
                    im
                ),
                gpuSmoothIteration: pixels[2] / 255 * chainCount
            });
        }

        gl.uniform1f(modeLocation, 1);
        gl.uniform4f(fixtureLocation, 0, 0, 0, DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        return {
            supported: true,
            values,
            maximumChainLength: DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH,
            gpuLongChainLength: pixels[3] / 255 * DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH
        };
    });

    test.skip(!result.supported, 'WebGL is unavailable in this browser');
    for (const fixture of result.values) {
        expect(fixture.gpuEscaped).toBe(fixture.expectedEscaped);
        expect(fixture.gpuFinite).toBe(fixture.cpuFinite);
        expect(Math.abs(fixture.gpuLogMagnitude - fixture.cpuLogMagnitude)).toBeLessThan(0.5);
        expect(Math.abs(fixture.gpuSmoothIteration - fixture.cpuSmoothIteration)).toBeLessThan(2.5);
    }
    expect(Math.abs(result.gpuLongChainLength - result.maximumChainLength)).toBeLessThan(5);
});
