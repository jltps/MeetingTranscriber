// electron-builder afterPack hook: stamp the Nexus icon (and version/product
// metadata) onto the packaged Windows .exe via rcedit.
//
// We do this here instead of letting electron-builder do it via
// `signAndEditExecutable: true`, because flipping that flag triggers
// electron-builder to download the winCodeSign bundle, which contains macOS
// symlinks that Windows can't extract without admin / Developer Mode. By
// running rcedit ourselves we get the icon-embedding without the signing
// machinery — code signing stays a separate, deferred concern (V07 §3
// future work).
//
// This is called by electron-builder once the unpacked app dir exists and
// before NSIS bundles it, so the installer wraps an already-iconified .exe.

const path = require('node:path');
const { rcedit } = require('rcedit');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productName; // 'Nexus'
  const version = packager.appInfo.version;
  const exePath = path.join(appOutDir, `${productName}.exe`);
  const iconPath = path.join(__dirname, 'icon.ico');

  await rcedit(exePath, {
    icon: iconPath,
    'version-string': {
      ProductName: productName,
      FileDescription: productName,
      CompanyName: packager.appInfo.companyName || productName,
      LegalCopyright: packager.appInfo.copyright || '',
      OriginalFilename: `${productName}.exe`,
    },
    'file-version': version,
    'product-version': version,
  });

  console.log(`[after-pack] embedded ${path.basename(iconPath)} into ${path.basename(exePath)}`);
};
