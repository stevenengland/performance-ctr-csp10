import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// deploy/ runs on its own and its layers point inwards (PRD #1 conventions).
const deployOnly = {
  group: ['**/web/**', '**/e2e/**', '**/scripts/**', '**/tests/**'],
  message: 'deploy/ imports only deploy/.',
};
const deployLayer = (folder, allowed, group) => ({
  files: [`deploy/${folder}/**/*.ts`],
  ignores: ['deploy/**/*.test.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          deployOnly,
          { group, message: `deploy/${folder}/ imports ${allowed}.` },
        ],
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'web/dist/**',
      'web/dist-preview/**',
      'api/vendor/**',
      'web/src/core/api-client/schema.d.ts',
      'playwright-report/**',
      'test-results/**',
      'screenshots/**',
      '.lighthouseci/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    // Node 24 type stripping runs these directly: only erasable syntax.
    files: ['deploy/**/*.ts', 'scripts/**/*.ts', 'e2e/support/serve-static.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'No enum: Node type stripping cannot run it.',
        },
        {
          selector: 'TSModuleDeclaration',
          message: 'No namespace: Node type stripping cannot run it.',
        },
        {
          selector: 'TSParameterProperty',
          message:
            'No parameter properties: Node type stripping cannot run them.',
        },
      ],
    },
  },
  {
    files: ['deploy/**/*.ts'],
    ignores: ['deploy/**/*.test.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [deployOnly] }] },
  },
  deployLayer('contract', 'no adapter', [
    '../io/**',
    '../webspace/**',
    '../*.ts',
  ]),
  deployLayer('webspace', 'only the contract', ['../io/**', '../*.ts']),
  {
    files: ['scripts/build-artifact.ts', 'web/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                'Import test/expect from ./support/playwright (CSP guard).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['web/src/**/*.{ts,vue}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'All HTTP calls go through web/src/core/api-client.',
        },
      ],
    },
  },
  {
    files: [
      'web/src/core/api-client/index.ts',
      '**/*.spec.ts',
      'web/preview/**',
    ],
    rules: { 'no-restricted-globals': 'off' },
  },
  prettier,
);
