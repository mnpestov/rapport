import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

function rgbToHex(color) {
  if (!color) return 'none';
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  const a = color.a !== undefined ? Math.round(color.a * 255).toString(16).padStart(2, '0') : 'ff';
  return `#${r}${g}${b}${a === 'ff' ? '' : a}`.toUpperCase();
}

function getFill(node) {
  if (node.fills && node.fills.length > 0 && node.fills[0].visible !== false) {
    const f = node.fills[0];
    if (f.type === 'SOLID') return rgbToHex(f.color);
  }
  return 'none';
}

function getStroke(node) {
  if (node.strokes && node.strokes.length > 0) {
    const s = node.strokes[0];
    if (s.type === 'SOLID') return rgbToHex(s.color);
  }
  return 'none';
}

function dump(node) {
  const b = node.absoluteBoundingBox;
  return {
    name: node.name,
    type: node.type,
    w: b?.width,
    h: b?.height,
    cornerRadius: node.cornerRadius,
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
    fontSize: node.style?.fontSize,
    fontWeight: node.style?.fontWeight,
    fontFamily: node.style?.fontFamily,
    color: node.fills ? (node.fills[0]?.type === 'SOLID' ? rgbToHex(node.fills[0].color) : 'none') : 'none',
    characters: node.characters,
    children: node.children?.map(c => c.name),
  };
}

let home = null;
function find(node) {
  if (node.name === '1.  home') { home = node; return; }
  node.children?.forEach(find);
}
find(data.document);

// Find exact nodes
const targets = {
  'Input Field / Android': null, // Search row wrapper
  'Input Field': null,           // Search input box  
  'search': null,                // Search icon
  'close_24': null,              // Clear icon
  'Frame 318': null,             // Favorites button container
  'lucide/heart (search)': null, // Heart icon (near search)
  'Menu': null,                  // Filters row
  'lucide/sliders-horizontal': null,
  'Line 1': null,                // Separator
};

const filterLabels = [];

function findTargets(node) {
  const n = node.name;
  if (n === 'Input Field / Android') targets['Input Field / Android'] = dump(node);
  if (n === 'Input Field') targets['Input Field'] = dump(node);
  if (n === 'search') targets['search'] = dump(node);
  if (n === 'close_24') targets['close_24'] = dump(node);
  if (n === 'Frame 318') targets['Frame 318'] = dump(node);
  if (n === 'lucide/heart' && !targets['lucide/heart']) targets['lucide/heart'] = dump(node);
  if (n === 'Menu') targets['Menu'] = dump(node);
  if (n === 'lucide/sliders-horizontal') targets['lucide/sliders-horizontal'] = dump(node);
  if (n === 'Line 1') targets['Line 1'] = dump(node);
  
  // Filter label buttons
  if (n === 'Label' && node.type === 'INSTANCE' && node.absoluteBoundingBox) {
    filterLabels.push(dump(node));
  }
  
  node.children?.forEach(c => findTargets(c));
}

findTargets(home);

console.log('=== NODES ===');
console.log(JSON.stringify(targets, null, 2));
console.log('=== FILTER LABELS (first 2) ===');
console.log(JSON.stringify(filterLabels.slice(0, 2), null, 2));
