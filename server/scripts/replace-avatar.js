const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');
const crypto = require('crypto');

// Usage: node replace-avatar.js <dicebear-style> <seed> <targetBaseName>
// Example: node replace-avatar.js identicon handkraft-05 137aba92-f5c7-44a5-a233-4ee164065d24

const style = process.argv[2] || 'identicon';
const seed = process.argv[3] || 'handkraft-01';
const baseName = process.argv[4] || '137aba92-f5c7-44a5-a233-4ee164065d24';

const outDir = path.join(__dirname, '..', 'uploads', 'avatars');
const mainName = `${baseName}.jpeg`;
const thumbName = `${baseName}-thumb.jpg`;

const url = `https://avatars.dicebear.com/api/${style}/${encodeURIComponent(seed)}.png?background=%23eaf6ff`;

async function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error('Failed to download image, status ' + res.statusCode));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function initialsFromSeed(seed) {
  if (!seed) return 'HF';
  const parts = seed.replace(/[_-]+/g, ' ').split(/\s+/).filter(Boolean);
  let initials = '';
  if (parts.length === 0) initials = seed.slice(0, 2);
  else if (parts.length === 1) initials = parts[0].slice(0, 2);
  else initials = (parts[0][0] || '') + (parts[1][0] || '');
  initials = initials.toUpperCase();
  return initials;
}

function colorsFromSeed(seed) {
  const hash = crypto.createHash('sha1').update(seed).digest();
  const r1 = hash[0], g1 = hash[1], b1 = hash[2];
  const r2 = hash[3], g2 = hash[4], b2 = hash[5];
  const c1 = `rgb(${r1},${g1},${b1})`;
  const c2 = `rgb(${r2},${g2},${b2})`;
  return [c1, c2];
}

function svgAvatar(seed, size = 1024) {
  const initials = initialsFromSeed(seed);
  const [c1, c2] = colorsFromSeed(seed);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.floor(size * 0.42)}" font-weight="700" fill="#FFFFFF">${initials}</text>
</svg>`;
  return svg;
}

(async () => {
  try {
    await fs.promises.mkdir(outDir, { recursive: true });
    let buf;
    try {
      console.log('Attempting download:', url);
      buf = await downloadToBuffer(url);
      console.log('Downloaded image from dicebear');
    } catch (err) {
      console.warn('Download failed, generating SVG avatar locally:', err.message);
      const svg = svgAvatar(seed, 1024);
      buf = Buffer.from(svg);
    }

    // Write main jpeg (1024x1024)
    const mainPath = path.join(outDir, mainName);
    await sharp(buf).resize({ width: 1024, height: 1024, fit: 'cover' }).jpeg({ quality: 90 }).toFile(mainPath);
    console.log('Wrote', mainPath);

    // Write thumbnail 320x320
    const thumbPath = path.join(outDir, thumbName);
    await sharp(buf).resize({ width: 320, height: 320, fit: 'cover' }).jpeg({ quality: 80 }).toFile(thumbPath);
    console.log('Wrote', thumbPath);

    console.log('Replacement complete');
    process.exit(0);
  } catch (err) {
    console.error('Failed to replace avatar:', err);
    process.exit(2);
  }
})();
