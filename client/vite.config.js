import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';

export default defineConfig({
  plugins: [react()],
  build: {
    target: ['es2021'],
    minify: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      // Do not externalize buffer, polyfill it instead
    },
  },
  resolve: {
    alias: {
      buffer: 'buffer', // Resolve buffer module to polyfill
    },
  },
  optimizeDeps: {
    include: ['buffer'], // Force include buffer in the bundle
    esbuildOptions: {
      target: 'es2021',
      define: {
        global: 'globalThis',
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true,
        }),
      ],
    },
  },
});
