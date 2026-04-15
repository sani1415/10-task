const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const fontData = fs.readFileSync(path.join(__dirname, 'arabic-font.woff2')).toString('base64');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <style>
      @font-face {
        font-family: "ArefRuqaa";
        src: url("data:font/woff2;base64,${fontData}") format("woff2");
      }
    </style>
  </defs>
  <rect width="512" height="512" fill="#0D3320"/>
  <text x="119" y="349" font-family="ArefRuqaa, serif" font-size="600" text-anchor="start" fill="#D4A843">&#x648;</text>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), svg);

sharp(Buffer.from(svg))
  .resize(512, 512)
  .png()
  .toFile(path.join(__dirname, 'icon-512.png'))
  .then(() => sharp(Buffer.from(svg)).resize(192, 192).png().toFile(path.join(__dirname, 'icon-192.png')))
  .then(() => console.log('Icons generated successfully!'))
  .catch(e => console.error('Error:', e.message));
