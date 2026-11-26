import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Validation failed: ${message}`);
  }
}

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert(buf.length >= 24 && buf.subarray(0, 8).equals(pngSig), `${filePath} is not a valid PNG`);
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function checkFileExists(relPath) {
  const fullPath = path.join(rootDir, relPath);
  assert(fs.existsSync(fullPath), `Missing referenced file: ${relPath}`);
  return fullPath;
}

function main() {
  const manifestPath = checkFileExists('manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert(manifest.manifest_version === 3, 'manifest_version must be 3');
  assert(typeof manifest.name === 'string' && manifest.name.length > 0, 'name is required');
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'version is required');

  // Verify icons and exact pixel dimensions
  for (const iconMap of [manifest.icons, manifest.action?.default_icon].filter(Boolean)) {
    for (const [size, relPath] of Object.entries(iconMap)) {
      const fullPath = checkFileExists(relPath);
      const { width, height } = readPngDimensions(fullPath);
      const expected = Number(size);
      assert(
        width === expected && height === expected,
        `Icon ${relPath} is ${width}x${height}, expected ${expected}x${expected}`
      );
    }
  }

  // Verify service worker, popup, and content scripts exist
  const jsFiles = new Set();
  if (manifest.background?.service_worker) {
    checkFileExists(manifest.background.service_worker);
    jsFiles.add(manifest.background.service_worker);
  }

  if (manifest.action?.default_popup) {
    const popupPath = checkFileExists(manifest.action.default_popup);
    const html = fs.readFileSync(popupPath, 'utf8');
    assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Inline <script> is forbidden by MV3 CSP');
    assert(!/\son[a-z]+\s*=/i.test(html), 'Inline event handlers are forbidden by MV3 CSP');
    jsFiles.add('popup/popup.js');
  }

  for (const cs of manifest.content_scripts || []) {
    for (const relJs of cs.js || []) {
      checkFileExists(relJs);
      jsFiles.add(relJs);
    }
  }

  // Syntax-check all JS files
  for (const relJs of jsFiles) {
    execFileSync(process.execPath, ['--check', path.join(rootDir, relJs)], { stdio: 'inherit' });
  }

  console.log(`Validation passed: ${manifest.name} v${manifest.version} (${jsFiles.size} JS files checked)`);
}

main();
