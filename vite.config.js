import { defineConfig } from 'vite';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function nativeEnginePlugin() {
  let rebuilding = false;
  return {
    name: 'native-complex-engine',
    async handleHotUpdate(context) {
      const nativeRoot = fileURLToPath(new URL('./native/', import.meta.url));
      if (!context.file.startsWith(nativeRoot) || context.file.includes('/native/build/') || rebuilding) return;
      rebuilding = true;
      await new Promise((resolve, reject) => {
        execFile(process.execPath, ['scripts/ensure-wasm.mjs'], { cwd: fileURLToPath(new URL('.', import.meta.url)) }, error => {
          rebuilding = false;
          if (error) reject(error);
          else resolve();
        });
      });
      context.server.ws.send({ type: 'full-reload' });
      return [];
    }
  };
}

export default defineConfig({
  base: '/complex-plane/',
  plugins: [nativeEnginePlugin()],
  worker: {
    format: 'es'
  },
  server: {
    port: 3000,
    watch: {
      ignored: ['**/.cache/**', '**/native/build/**', '**/dist/**']
    }
  }
});
