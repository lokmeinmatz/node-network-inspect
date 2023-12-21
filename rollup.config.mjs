import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
/**
 * @type {import('rollup').RollupOptions}
 */
export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/cjs/index.js',
      format: 'cjs',
      exports: 'named',
    },
    {
      file: 'dist/esm/index.js',
      format: 'esm',
      exports: 'named',
    },
  ],
  plugins: [
    nodeResolve(),
    typescript()
  ]
}