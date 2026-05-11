const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;
const serverPath = path.resolve(__dirname, '..', 'server').replace(/\\/g, '\\\\');

module.exports = (async () => {
  const config = await getDefaultConfig(projectRoot);

  // Avoid Metro traversing the monorepo server folder which contains Node-only modules
  config.watchFolders = [];
  config.resolver.blockList = exclusionList([
    /.*\\/server\\/.*$/,
    /.*\/server\/.*/,
  ]);

  // Ensure node_modules resolution is local to the mobile folder
  config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

  return config;
})();
