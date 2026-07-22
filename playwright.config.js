import { defineConfig } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: false,
    use: {
        baseURL: 'http://127.0.0.1:4173/complex-plane/',
        viewport: { width: 1440, height: 1000 },
        launchOptions: executablePath ? { executablePath } : {},
        screenshot: 'only-on-failure'
    },
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173/complex-plane/',
        reuseExistingServer: true
    }
});
