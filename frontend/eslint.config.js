import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': 'off',
    },
  },
  {
    // Guard: no legacy hard-coded hosts in source (plan risk table)
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/shared/api/base.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: "Literal[value=/api\.naqsha-zameen\.pk|localhost:5000/]", message: 'Use apiBase()/apiUrl() from @/shared/api/base' },
      ],
    },
  },
);
