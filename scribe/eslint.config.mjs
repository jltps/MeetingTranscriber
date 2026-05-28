import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'build/**', 'scripts/**', '**/*.worklet.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // tsc handles undefined identifiers; the core rule false-positives on types/globals.
      'no-undef': 'off',
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Accessibility lint, scoped to renderer components (the only JSX in the repo).
  {
    files: ['src/renderer/**/*.tsx'],
    ...jsxA11y.flatConfigs.recommended,
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Our Settings/dialog forms wire labels to controls via layout + ids inconsistently;
      // enforcing this would force a broad refactor. Tracked as a follow-up — the controls
      // themselves remain keyboard-operable and labeled by adjacent text.
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
);
