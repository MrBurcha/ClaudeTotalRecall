const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Firma ad-hoc del bundle en macOS. electron-builder corre sin certificado
// (uso personal), así que el bundle sale sin sellar y en Apple Silicon macOS
// lo marca como "dañado". La firma ad-hoc sella los recursos y evita ese
// error; no notariza, pero habilita el flujo "desarrollador no identificado".
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
