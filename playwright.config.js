import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const gpuAngle = process.env.PLAYWRIGHT_GPU_ANGLE || 'swiftshader';

export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:4173/complex-plane/',
        viewport: { width: 1440, height: 1000 },
        launchOptions: { ...(executablePath ? { executablePath } : {}),
            args: ['--enable-gpu', `--use-angle=${gpuAngle}`] },
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        env: { VITE_BROWSER_TEST: '1' },
        url: 'http://127.0.0.1:4173/complex-plane/',
        reuseExistingServer: false
    }
});
