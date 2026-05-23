/**
 * Solidarity monorepo Prettier config.
 * Mirrors aniseekr-expo for stylistic consistency.
 */
module.exports = {
  printWidth: 100,
  tabWidth: 2,
  singleQuote: true,
  bracketSameLine: true,
  trailingComma: 'es5',
  semi: true,
  arrowParens: 'always',
  plugins: [require.resolve('prettier-plugin-tailwindcss')],
  tailwindAttributes: ['className'],
};
