// scripts/generate-icon.js
// Run: node scripts/generate-icon.js
// Generates a 128x128 PNG icon from images/icon.svg
//
// Requires the 'sharp' package:
//   npm install --save-dev sharp
//   node scripts/generate-icon.js
//
// Alternatively use Inkscape:
//   inkscape images/icon.svg --export-png=images/icon.png --export-width=128 --export-height=128
//
// Or ImageMagick:
//   convert -background none images/icon.svg -resize 128x128 images/icon.png

'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const svgPath = path.join(rootDir, 'images', 'icon.svg');
const pngPath = path.join(rootDir, 'images', 'icon.png');

// Check if canvas is available
try {
  const sharp = require('sharp');
  const svgBuf = fs.readFileSync(svgPath);
  sharp(svgBuf)
    .resize(128, 128)
    .png()
    .toFile(pngPath, (err) => {
      if (err) {
        console.error('Error generating icon:', err);
        process.exit(1);
      }
      console.log('Icon generated: images/icon.png (via sharp)');
    });
} catch (e) {
  console.log('sharp package not available. Falling back to canvas...');
  try {
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(128, 128);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#1e1e2e';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, 128, 128, 16);
    } else {
      ctx.rect(0, 0, 128, 128);
    }
    ctx.fill();

    // M letter
    ctx.fillStyle = '#89b4fa';
    ctx.font = 'bold 72px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', 64, 58);

    // Purple accent bar
    ctx.fillStyle = 'rgba(203, 166, 247, 0.8)';
    ctx.beginPath();
    ctx.roundRect(20, 90, 88, 4, 2);
    ctx.fill();

    // Cyan accent bar
    ctx.fillStyle = 'rgba(137, 220, 235, 0.6)';
    ctx.beginPath();
    ctx.roundRect(32, 100, 64, 3, 1.5);
    ctx.fill();

    fs.writeFileSync(pngPath, canvas.toBuffer('image/png'));
    console.log('Icon generated: images/icon.png (via canvas)');
  } catch (e2) {
    console.error('Neither sharp nor canvas is available.');
    console.error('Install one of them:');
    console.error('  npm install --save-dev sharp');
    console.error('  npm install --save-dev canvas');
    process.exit(1);
  }
}
