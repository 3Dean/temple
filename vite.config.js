import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';
                                    
export default defineConfig({
  plugins: [glsl()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    open: true // optional: auto-open browser when you run `vite`
}
}); 
                   