const fs = require('fs-extra');
const path = require('path');

async function loadNextReel() {
  const metadata = await fs.readJson('./metadata/metadata.json');
  if (!metadata.length) return null;

  const reel = metadata.shift();
  await fs.writeJson('./metadata/metadata.json', metadata, { spaces: 2 });

  const reelPath = path.join(__dirname, 'reels', reel.file);
  if (!await fs.pathExists(reelPath)) {
    throw new Error(`Video not found: ${reel.file}`);
  }

  return {
    path: reelPath,
    caption: reel.caption
  };
}

module.exports = { loadNextReel };
