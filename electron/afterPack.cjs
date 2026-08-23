'use strict';

const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const productName = context.packager.appInfo.productFilename;
  const primaryExe = path.join(context.appOutDir, productName + '.exe');
  const runtimeExe = path.join(context.appOutDir, productName + '-runtime.exe');
  const launcherExe = path.join(__dirname, '..', 'build', 'MYRAA-launcher.exe');

  if (fs.existsSync(primaryExe) && fs.existsSync(launcherExe)) {
    try {
      await fs.promises.copyFile(primaryExe, runtimeExe);
      await fs.promises.copyFile(launcherExe, primaryExe);
    } catch (e) {
      console.warn('afterPack launcher copy warning:', e.message);
    }
  }
};
