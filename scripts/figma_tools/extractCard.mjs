import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

function rgbToHex(color) {
  if (!color) return 'none';
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function getFill(node) {
  if (node.fills && node.fills.length > 0 && node.fills[0].visible !== false) {
    const f = node.fills[0];
    if (f.type === 'SOLID') return rgbToHex(f.color);
  }
  return 'none';
}
function getStroke(node) {
  if (node.strokes && node.strokes.length > 0 && node.strokes[0].visible !== false) {
    const s = node.strokes[0];
    if (s.type === 'SOLID') return rgbToHex(s.color);
  }
  return 'none';
}

function dumpNode(node, imageRef) {
  const b = node.absoluteBoundingBox;
  const result = {
    name: node.name,
    type: node.type,
    w: b?.width,
    h: b?.height,
    cornerRadius: node.cornerRadius,
    individualRadius: node.rectangleCornerRadii,
    pt: node.paddingTop,
    pr: node.paddingRight,
    pb: node.paddingBottom,
    pl: node.paddingLeft,
    gap: node.itemSpacing,
    dir: node.layoutMode,
    alignCounter: node.counterAxisAlignItems,
    alignPrimary: node.primaryAxisAlignItems,
    fill: getFill(node),
    stroke: getStroke(node),
    strokeWeight: node.strokeWeight,
    fontSize: node.style?.fontSize,
    fontWeight: node.style?.fontWeight,
    fontFamily: node.style?.fontFamily,
    lineHeightPx: node.style?.lineHeightPx,
    lineHeightPercent: node.style?.lineHeightPercent,
    textColor: node.fills?.[0]?.type === 'SOLID' ? rgbToHex(node.fills[0].color) : 'none',
    characters: node.characters,
    children: node.children?.map(c => c.name),
  };
  
  // Calculate position relative to image if provided
  if (imageRef && b && imageRef.absoluteBoundingBox) {
    const ib = imageRef.absoluteBoundingBox;
    result.relTop = b.y - ib.y;
    result.relRight = (ib.x + ib.w) - (b.x + b.width);
    result.relBottom = (ib.y + ib.h) - (b.y + b.height);
    result.relLeft = b.x - ib.x;
  }
  
  return result;
}

let home = null;
function findHome(node) {
  if (node.name === '1.  home') { home = node; return; }
  node.children?.forEach(findHome);
}
findHome(data.document);

// Find the first Item instance and analyze all its children
let itemNode = null;
function findItem(node) {
  if (node.name === 'Item' && node.type === 'INSTANCE' && node.absoluteBoundingBox) {
    if (!itemNode) itemNode = node;
    return;
  }
  node.children?.forEach(findItem);
}
findItem(home);

if (!itemNode) { console.log('Item not found'); process.exit(1); }

// Find image node inside Item
let imageNode = null;
function findImage(node) {
  if (node.name === '🖼️ Image') { imageNode = node; return; }
  node.children?.forEach(findImage);
}
findImage(itemNode);

const imageRef = imageNode ? { absoluteBoundingBox: imageNode.absoluteBoundingBox, w: imageNode.absoluteBoundingBox?.width, h: imageNode.absoluteBoundingBox?.height } : null;

// Dump all immediate children + nested important ones
function analyze(node, depth = 0, ref = null) {
  const result = { ...dumpNode(node, ref), depth };
  result.childDetails = node.children?.map(c => analyze(c, depth + 1, ref));
  return result;
}

const fullItem = analyze(itemNode, 0, imageRef);

// Also get specific nodes
const nodes = {};
function findNamed(node, names) {
  if (names.includes(node.name)) {
    if (!nodes[node.name]) nodes[node.name] = dumpNode(node, imageRef);
  }
  node.children?.forEach(c => findNamed(c, names));
}

findNamed(itemNode, ['🖼️ Image', 'Body', 'Title', 'Frame 317', 'tag', 'Label', 'lucide/heart', 'lucide/astroid', 'lucide/paintbrush-vertical']);

// Find vector inside heart (actual icon size)
let heartVec = null;
function findHeartVec(node) {
  if (node.name === 'lucide/heart') {
    // Look for Vector child
    node.children?.forEach(c => {
      if (c.name === 'Vector') heartVec = dumpNode(c, imageRef);
    });
  }
  node.children?.forEach(findHeartVec);
}
findHeartVec(itemNode);

console.log('=== ITEM ===');
console.log(JSON.stringify(dumpNode(itemNode, null), null, 2));
console.log('=== IMAGE ===');
console.log(JSON.stringify(dumpNode(imageNode, imageRef), null, 2));
console.log('=== NAMED NODES ===');
console.log(JSON.stringify(nodes, null, 2));
console.log('=== HEART VECTOR ===');
console.log(JSON.stringify(heartVec, null, 2));
