/**
 * Metro config — Expo + NativeWind 4 + monorepo (bun workspaces).
 *
 * Bun's symlink-hoisted node_modules layout puts every package inside
 * .bun/<pkg>@<hash>/node_modules/<pkg>/. Metro's default node-modules
 * resolver walks the directory tree, so we DO want hierarchical lookup
 * enabled — turning it off has caused
 *   "TypeError: Cannot read properties of undefined (reading 'transformFile')"
 * because metro/babel can't find its own peer deps.
 *
 * Watch the whole workspace so changes in packages/shared etc. trigger
 * a fast refresh.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Leave `disableHierarchicalLookup` at its default (false) so Metro can
// resolve peer deps through bun's .bun/<pkg>/ layout.

module.exports = withNativeWind(config, { input: './global.css' });
