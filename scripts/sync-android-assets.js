/**
 * Synchronizes built web assets from dist/ to android/app/src/main/assets/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const distDir = path.join(rootDir, 'dist');
const androidAssetsDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets');

console.log('[Android Asset Sync] Checking build artifacts...');

if (!fs.existsSync(distDir)) {
  console.error('[Android Asset Sync] Error: dist/ directory does not exist. Run "npm run build" first.');
  process.exit(1);
}

if (!fs.existsSync(androidAssetsDir)) {
  console.log(`[Android Asset Sync] Creating directory: ${androidAssetsDir}`);
  fs.mkdirSync(androidAssetsDir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  console.log(`[Android Asset Sync] Copying dist/ -> ${androidAssetsDir}...`);
  copyRecursive(distDir, androidAssetsDir);

  // Copy icon and favicon if available
  const iconPng = path.join(rootDir, 'icon.png');
  const iconIco = path.join(rootDir, 'icon.ico');
  if (fs.existsSync(iconPng)) {
    fs.copyFileSync(iconPng, path.join(androidAssetsDir, 'icon.png'));
  }
  if (fs.existsSync(iconIco)) {
    fs.copyFileSync(iconIco, path.join(androidAssetsDir, 'favicon.ico'));
  }

  console.log('[Android Asset Sync] Successfully synced web assets to Android companion app.');
} catch (err) {
  console.error('[Android Asset Sync] Error syncing assets:', err);
  process.exit(1);
}
