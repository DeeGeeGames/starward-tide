import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
	js.configs.recommended,
	{
		files: ['eslint.config.js', '*.config.{js,ts}', 'scripts/**/*.ts'],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				ecmaVersion: 'latest',
				sourceType: 'module',
			},
			globals: {
				...globals.browser,
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': 'error',
			'@typescript-eslint/explicit-function-return-type': 'warn',
			'@typescript-eslint/no-explicit-any': 'error',
			'prefer-const': 'error',
			'no-var': 'error',
		},
	},
	{
		ignores: ['dist', 'node_modules'],
	},
];
