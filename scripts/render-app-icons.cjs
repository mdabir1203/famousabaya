'use strict';
/**
 * Rasterize public/icons/timedilemma.svg to PNGs for PWA / Apple touch.
 * Requires: yarn install (devDependency sharp)
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.join(__dirname, '../public/icons/timedilemma.svg');
const outDir = path.join(__dirname, '../public/icons');

async function main() {
  if (!fs.existsSync(svgPath)) {
    console.error('Missing', svgPath);
    process.exit(1);
  }
  const svg = fs.readFileSync(svgPath);
  const sizes = [
    [180, 'apple-touch-icon.png'],
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
  ];
  for (const [size, name] of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(outDir, name));
    console.log('Wrote', name, size + '×' + size);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
