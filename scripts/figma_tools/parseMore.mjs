import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

const findNodeWithText = (node, text) => {
  if (node.characters && node.characters.toLowerCase().includes(text.toLowerCase())) {
    return node;
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeWithText(child, text);
      if (found) return found;
    }
  }
  return null;
}

const findParentWithCornerRadius = (node) => {
  let curr = node;
  // This is a naive tree search, we don't have parent links, so we'll just do a general search for "badge" like things.
}

const results = [];
function findEverything(node) {
  if (node.name && (node.name.includes('Badge') || node.name.includes('Бесплатно') || node.name.includes('Tag'))) {
    results.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      findEverything(child);
    }
  }
}
findEverything(data.document);

fs.writeFileSync('badges.json', JSON.stringify(results.map(n => ({
  name: n.name,
  width: n.absoluteBoundingBox?.width,
  height: n.absoluteBoundingBox?.height,
  cornerRadius: n.cornerRadius,
  padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft]
})), null, 2));

const filters = [];
function findFilters(node) {
  if (node.name && (node.name.includes('Filter') || node.name.includes('Tag'))) {
    filters.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      findFilters(child);
    }
  }
}
findFilters(data.document);
fs.writeFileSync('filters.json', JSON.stringify(filters.map(n => ({
  name: n.name,
  width: n.absoluteBoundingBox?.width,
  height: n.absoluteBoundingBox?.height,
  cornerRadius: n.cornerRadius,
  padding: [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft]
})), null, 2));
