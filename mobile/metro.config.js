// Learn more: https://docs.expo.dev/guides/monorepo/
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const sharedSrc = path.join(workspaceRoot, 'shared', 'src');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace so edits in `shared/` trigger a reload.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the package first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

// 3. `shared/` is consumed as raw TypeScript and uses NodeNext-style `./foo.js`
//    specifiers that point at `foo.ts`. TypeScript understands that substitution;
//    Metro resolves specifiers literally and would 404. Rewrite them, scoped to
//    files inside `shared/src` so nothing else in the graph changes behaviour.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const fromShared = context.originModulePath?.startsWith(sharedSrc) ?? false;
  if (fromShared && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    return resolve(context, moduleName.slice(0, -'.js'.length), platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
