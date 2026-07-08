const { execFileSync } = require('node:child_process')
const path = require('node:path')

// Ad-hoc-sign the bundle on macOS. electron-builder runs without a certificate
// (personal use), so the bundle ships unsealed and Apple Silicon macOS flags it
// as "damaged". The ad-hoc signature seals the resources and avoids that error;
// it does not notarize, but it enables the "unidentified developer" open flow.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
