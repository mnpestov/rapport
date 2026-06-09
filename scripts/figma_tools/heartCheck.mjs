import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

let targetItem = null;

function searchContext(node) {
  if (node.name === 'Item' && node.absoluteBoundingBox) {
    if (!targetItem) targetItem = node;
  }
  if (node.children) {
    node.children.forEach(searchContext);
  }
}
searchContext(data.document);

function analyzeHeartPos(node, imageNode) {
  if (node.name === 'lucide/heart') {
    if (imageNode && node.absoluteBoundingBox && imageNode.absoluteBoundingBox) {
      const top = node.absoluteBoundingBox.y - imageNode.absoluteBoundingBox.y;
      const right = (imageNode.absoluteBoundingBox.x + imageNode.absoluteBoundingBox.width) - (node.absoluteBoundingBox.x + node.absoluteBoundingBox.width);
      console.log(`Heart Координаты: top: ${top}px, right: ${right}px`);
    }
  }
  if (node.children) node.children.forEach(c => analyzeHeartPos(c, imageNode));
}

function findImage(node) {
  if (node.name === '🖼️ Image') return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findImage(c);
      if (found) return found;
    }
  }
  return null;
}

if (targetItem) {
  const img = findImage(targetItem);
  analyzeHeartPos(targetItem, img);
}

