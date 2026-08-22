import { defineConfig } from 'tsdown'

const PLUGIN_ID = '@sidleo3/agent-instructions-plus'
/** Platform modules resolved from the DSH loader module table (external). */
const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/**
 * Build config for @sidleo3/agent-instructions-plus.
 *
 * Three outputs:
 *  - host   → lib/index.js  (ESM host entry: provider, RPC, GUI config)
 *  - preset → lib/preset.js (ESM session-plane entry: injection pipeline,
 *             inserted into a copied agent preset by the wizard)
 *  - client → lib/client.js (CJS factory wrapped in window.__ModuleLoader__.load;
 *             platform modules stay external via the loader's require)
 */
export default defineConfig([
  {
    name: 'agent-instructions-plus/host',
    entry: { 'index': 'src/index.ts' },
    format: ['esm'],
    outDir: 'lib',
    outExtension() {
      return { js: '.js', dts: '.d.ts' }
    },
    target: 'node22',
    dts: { minify: false },
    sourcemap: true,
    clean: false,
  },
  {
    name: 'agent-instructions-plus/preset',
    entry: { 'preset': 'src/preset.ts' },
    format: ['esm'],
    outDir: 'lib',
    outExtension() {
      return { js: '.js', dts: '.d.ts' }
    },
    target: 'node22',
    dts: { minify: false },
    sourcemap: true,
    clean: false,
  },
  {
    name: 'agent-instructions-plus/client',
    entry: { 'client': 'src/client/index.ts' },
    format: 'cjs',
    platform: 'browser',
    outDir: 'lib',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...EXTERNALS],
    noExternal: (id) => (EXTERNALS.includes(id) ? undefined : true),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
