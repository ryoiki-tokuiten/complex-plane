import { defineConfig } from '@playwright/test';
import fs from 'fs';

const systemChrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || systemChrome;
const gpuAngle = process.env.PLAYWRIGHT_GPU_ANGLE || 'gl';

export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4173/complex-plane/',
        viewport: { width: 1440, height: 1000 },
        launchOptions: {
            ...(executablePath ? { executablePath } : {}),
            env: {
                ...process.env,
                __NV_PRIME_RENDER_OFFLOAD: '1',
                __GLX_VENDOR_LIBRARY_NAME: 'nvidia'
            },
            args: [
                '--enable-gpu',
                '--force_high_performance_gpu',
                '--ignore-gpu-blocklist',
                `--use-angle=${gpuAngle}`
            ]
        },
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        env: { VITE_BROWSER_TEST: '1' },
        url: 'http://127.0.0.1:4173/complex-plane/',
        reuseExistingServer: true
    }
});
