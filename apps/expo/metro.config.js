/**
 * Metro config — Expo + NativeWind v5 + monorepo (bun workspaces).
 *
 * Important pieces:
 * - `withMetroConfig` from `expo/metro-config` provides Expo defaults.
 * - `withNativeWind` injects PostCSS for `global.css`.
 * - `nodeModulesPaths` + `watchFolders` are required for the monorepo so
 *   Metro resolves `@solidarity/shared` and the local nitro-modules without
 *   bun symlink hoisting surprises.
 */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the whole workspace and resolve from both locations.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = withNativeWind(config, { input: './global.css' });
