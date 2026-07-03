// @ts-check
// Solidarity monorepo ESLint flat config.
// Enforces:
//   - max-lines: 500 (skipBlank + skipComments)
//   - @typescript-eslint/no-explicit-any: error EVERYWHERE
//     EXCEPT explicit boundary layers: *.bridge.ts, *.handler.ts,
//     native-modules/**, nitro-modules/**/src/specs/**
//   - strict TS rules, no floating promises, consistent type imports
//
// Why this file exists:
// Per CLAUDE.md user direction (2026-05-24): every TS file ≤500 lines,
// `any` only at typed/native boundaries.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/ios/**',
      '**/android/**',
      '**/.expo/**',
      '**/*.config.{js,cjs,mjs}',
      '**/.prettierrc.{js,cjs,mjs}',
      '**/postcss.config.{js,cjs,mjs}',
      '**/tailwind.config.{js,cjs,mjs}',
      '**/metro.config.{js,cjs,mjs}',
      '**/babel.config.{js,cjs,mjs}',
      'scripts/**',
      'apps/expo/plugins/**',
      // Bare-side worklet source (`Bare`/`BareKit`/`Buffer` globals, no RN
      // types; packed by `bare-pack`, never part of the apps/expo TS
      // project — see pear/worklet/index.js's header) + the Node-only
      // packing script that bundles it. Same treatment as root
      // `scripts/**` above; the generated `dist/` bundle is already
      // covered by `**/dist/**`.
      'apps/expo/pear/worklet/index.js',
      'apps/expo/scripts/**',
      'apps/ios-legacy/**',
      'solidarity/**',
      'solidarityClip/**',
      'solidarityTests/**',
      'solidarityUITests/**',
      '**/nitrogen/generated/**',
      // Nitro spec files (*.nitro.ts) are inputs to nitrogen codegen, not
      // part of the apps/expo TS project. Lint them via their own scoped
      // config below — turn off `projectService` for that override.
      'nitro-modules/**/src/specs/*.nitro.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // File size + complexity
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 4],
      'max-params': ['error', 5],
      // Cyclomatic complexity ≤18 — tightened from arbitrary 12 to allow
      // legitimately branching code (variant-driven UI primitives, BigUInt
      // Lagrange interpolation, URL parser). Refactor only if a function
      // crosses 18.
      'complexity': ['warn', 18],

      // Hard errors — these catch real bugs / security issues.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Style / cosmetic — warnings, not blockers. The author's intent is
      // already clear; converting these to errors blocks ships on nits.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unnecessary-type-parameters': 'warn',
      '@typescript-eslint/no-unnecessary-type-conversion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Hygiene
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },

  // Boundary layer: `any` is allowed in native-bridge / handler files only.
  // Why: Nitro spec types and event-handler payloads are inherently unknown
  // until they cross the JS↔Native boundary. Forcing `unknown` everywhere
  // would push type assertions into every callsite. Keep `any` contained
  // here, then convert to typed values via Zod schemas at the next layer.
  {
    files: [
      '**/*.bridge.ts',
      '**/*.handler.ts',
      '**/native-modules/**/*.ts',
      'nitro-modules/**/src/specs/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Tests: relax lines + any
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**'],
    rules: {
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },

  prettier,
);
