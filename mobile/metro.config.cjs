const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;

// Get default Expo/Metro config synchronously and adjust it for the monorepo
const config = getDefaultConfig(projectRoot);

// Avoid Metro traversing the monorepo server folder which contains Node-only modules
config.watchFolders = [];
config.resolver.blockList = exclusionList([/.*[\\\/]server[\\\/].*/]);

// Ensure node_modules resolution is local to the mobile folder
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
