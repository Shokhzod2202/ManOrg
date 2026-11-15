import { config } from '@manorg/config/eslint';

export default [
  ...config,
  {
    // Local developer tools: Node scripts and browser checks, not shipped code.
    files: ['scripts/**', 'apps/web/e2e/**'],
    languageOptions: {
      globals: {
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        Blob: 'readonly',
        FormData: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-console': 'off' },
  },
];
