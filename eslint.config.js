//  @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'

export default [
  ...tanstackConfig,
  {
    ignores: [
      'eslint.config.js',
      'prettier.config.js',
      'vite.config.ts',
      // Generated build artifacts — never linted (esbuild output, Vite dist, coverage).
      'electron/server-bundle.cjs',
      'dist/**',
      'dist-electron/**',
      'coverage/**',
      'playground-ws-worker/dist/**',
      // Not part of the typed app TS project (type-aware lint can't parse them):
      // e2e runs under Playwright's own pipeline; these are plain-JS scripts/bootstrap.
      'e2e/**',
      'public/**',
      'scripts/**',
      'server-entry.js',
    ],
  },
  {
    // Block client-side imports of server-only MCP input types.
    // `src/types/mcp-input.ts` may carry secret-bearing fields and must
    // never be referenced from screens or shared components.
    files: ['src/screens/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/types/mcp-input',
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
          patterns: [
            {
              group: ['**/types/mcp-input', '**/types/mcp-input.ts'],
              message:
                'mcp-input.ts is server-only (carries unmasked secrets). Import McpClientInput from @/types/mcp instead.',
            },
          ],
        },
      ],
    },
  },
]
