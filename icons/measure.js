// Render the letter on white bg, then find leftmost and rightmost golden pixels
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const fontData = fs.readFileSync(path.join(__dirname, 'arabic-font.woff2')).toString('base64');

// Render on WHITE background so we can find the letter bounds
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <style>
      @font-face {
        font-family: "ArefRuqaa";
        src: url("data:font/woff2;base64,${fontData}") format("woff2");
      }
    </style>
  </defs>
  <rect width="512" height="512" fill="white"/>
  <text x="140" y="400" font-family="ArefRuqaa, serif" font-size="600" text-anchor="start" fill="black">&#x648;</text>
</svg>`;

sharp(Buffer.from(svg))
  .raw()
  .toBuffer({ resolveWithObject: true })
  .then(({ data, info }) => {
    let minX = 512, maxX = 0, minY = 512, maxY = 0;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = (y * info.width + x) * info.channels;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        if (r < 200) { // dark pixel = letter
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    console.log(`Letter bounds: x=${minX}-${maxX}, y=${minY}-${maxY}`);
    console.log(`Width=${maxX-minX}, Height=${maxY-minY}`);
    console.log(`Visual center: x=${Math.round((minX+maxX)/2)}, y=${Math.round((minY+maxY)/2)}`);
    console.log(`Offset needed: x=${256 - Math.round((minX+maxX)/2)}, y=${256 - Math.round((minY+maxY)/2)}`);
  });
