import { defineConfig, loadEnv } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const ttsApiBase = env.VITE_TTS_API_BASE?.replace(/\/+$/, '');

  return {
    plugins: [glsl()],
    base: './',
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    server: {
      open: true,
      proxy: ttsApiBase
        ? {
            '/api': {
              target: ttsApiBase,
              changeOrigin: true,
              secure: true,
            },
          }
        : undefined,
    },
  };
});
