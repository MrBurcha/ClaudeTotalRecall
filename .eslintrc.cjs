/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    // Turn off ESLint rules that conflict with Prettier (formatting is Prettier's job).
    'prettier',
  ],
  env: { node: true, browser: true, es2022: true },
  ignorePatterns: ['out/', 'dist-cli/', 'release/', 'node_modules/', 'coverage/'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // React hooks correctness (all 43 .tsx components were previously unchecked).
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
  overrides: [
    {
      // Type-aware linting only for the app sources (they're all in tsconfig).
      // The projectService loads type info per file so rules that need types work.
      files: ['src/**/*.{ts,tsx}'],
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/await-thenable': 'error',
        // Async handlers passed to React attributes (onClick={async …}) are fine;
        // catch the genuinely dangerous cases (async in a non-void callback, etc.).
        '@typescript-eslint/no-misused-promises': [
          'error',
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
    {
      // Tests use `any` for mocks/fixtures — that's fine.
      files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
}
