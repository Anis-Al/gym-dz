// Installer settings for `npm run dist`. A JS file (not package.json "build") so the names follow config.js.
const APP = require('./config');

// names go into file names (exe, install folder, Start-menu shortcut): drop the characters Windows forbids
const productName = APP.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'App';
// installer file name: no spaces, no accents
const fileName = productName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'App';

module.exports = {
  appId: 'dz.gym.app', // identity of the installed app; only matters if two forks are installed on the same PC
  // productName here (NOT in package.json): it names the exe, shortcut and installer, but the app's own name (= data folder) stays package.json "name"
  productName,
  directories: { output: 'dist' },
  // only the app itself is packed: never demo-data.js, the .bat files or the sample CSV
  files: ['main.js', 'preload.js', 'xlsx.js', 'config.js', 'app.js', 'index.html', 'style.css', 'package.json'],
  win: { target: 'nsis' },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: fileName + '-Setup-${version}.exe',
  },
};
