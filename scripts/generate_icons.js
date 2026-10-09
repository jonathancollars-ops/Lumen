// The cutout master is produced with Imagegen. This script only sizes and encodes
// that artwork for the native launchers; it preserves its alpha channel.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Jimp = require('jimp-compact');

const root = path.resolve(__dirname, '..');

async function main() {
  const master = await Jimp.read(path.join(root, 'assets/lumen-gem.png'));
  let left = master.bitmap.width, top = master.bitmap.height, right = 0, bottom = 0;
  master.scan(0, 0, master.bitmap.width, master.bitmap.height, (x, y, index) => {
    if (master.bitmap.data[index + 3] > 20) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  });
  if (right <= left || bottom <= top) throw new Error('The gem master is empty.');
  const gem = master.crop(left, top, right - left + 1, bottom - top + 1);

  function canvas(size, heightFraction) {
    const symbol = gem.clone().resize(Jimp.AUTO, Math.round(size * heightFraction), Jimp.RESIZE_BICUBIC);
    return new Jimp(size, size, 0x00000000).composite(symbol,
      Math.round((size - symbol.bitmap.width) / 2), Math.round((size - symbol.bitmap.height) / 2));
  }

  await canvas(1024, 0.92).writeAsync(path.join(root, 'assets/icon.png'));
  await canvas(64, 0.92).writeAsync(path.join(root, 'assets/favicon.png'));
  // Android's 108 dp adaptive canvas has a central 66 dp safe zone.
  const foreground = canvas(1024, 0.60);
  await foreground.writeAsync(path.join(root, 'assets/android-icon-foreground.png'));
  await foreground.clone().writeAsync(path.join(root, 'assets/adaptive-icon.png'));
  await new Jimp(1024, 1024, 0x00000000).writeAsync(path.join(root, 'assets/android-icon-background.png'));
  const monochrome = foreground.clone();
  monochrome.scan(0, 0, 1024, 1024, (_, __, index) => {
    monochrome.bitmap.data[index] = 255;
    monochrome.bitmap.data[index + 1] = 255;
    monochrome.bitmap.data[index + 2] = 255;
  });
  await monochrome.writeAsync(path.join(root, 'assets/android-icon-monochrome.png'));

  const output = path.join(root, '.expo/gem-icons');
  execFileSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'icon', path.join(root, 'assets/icon.png'), '--output', output], { stdio: 'inherit' });
  // Tauri also generates mobile assets; Expo owns those, so copy only desktop assets.
  for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
    if (entry.isFile()) fs.copyFileSync(path.join(output, entry.name), path.join(root, 'src-tauri/icons', entry.name));
  }
  console.log('Launcher assets generated with transparent backgrounds.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
