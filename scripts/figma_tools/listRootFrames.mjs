import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

data.document.children.forEach(page => {
  console.log(`Page: ${page.name}`);
  page.children?.forEach(frame => {
    console.log(`  Frame: ${frame.name} (W:${frame.absoluteBoundingBox?.width} H:${frame.absoluteBoundingBox?.height})`);
  });
});
