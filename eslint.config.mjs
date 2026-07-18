// ESLint flat config (ESLint 10). Replaces the legacy .eslintrc.cjs — v9 dropped
// eslintrc and v10 removed it entirely. Behaviour is a 1:1 port of the old config:
// same rule set, same type-aware block scoped to app sources, same test override.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  // Not linted (was ignorePatterns).
  { ignores: ['out/', 'dist-cli/', 'release/', 'coverage/', 'node_modules/'] },

  // Base: only TypeScript sources are linted (the old `--ext .ts,.tsx`). Flat
  // config has no env, so node + browser globals are declared explicitly.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // React hooks correctness (all .tsx components were previously unchecked).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Type-aware linting only for the app sources (they're all in tsconfig).
  // The projectService loads type info per file so rules that need types work.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
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

  // Tests use `any` for mocks/fixtures — that's fine.
  {
    files: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Turn off ESLint rules that conflict with Prettier (formatting is Prettier's job).
  prettier,
)
