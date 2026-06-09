import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

let homeNode = null;
function findHome(node) {
  if (node.name === '1.  home') {
    homeNode = node;
    return true;
  }
  if (node.children) {
    for (const c of node.children) {
      if (findHome(c)) return true;
    }
  }
}
findHome(data.document);

function getLayout(node, depth = 0) {
  if (!node) return '';
  const indent = '  '.repeat(depth);
  let str = `${indent}- ${node.name} [${node.type}] (W:${node.absoluteBoundingBox?.width} H:${node.absoluteBoundingBox?.height})`;
  
  const layoutProps = [];
  if (node.layoutMode) layoutProps.push(`dir=${node.layoutMode}`);
  if (node.itemSpacing !== undefined) layoutProps.push(`gap=${node.itemSpacing}`);
  if (node.paddingTop !== undefined || node.paddingRight !== undefined || node.paddingBottom !== undefined || node.paddingLeft !== undefined) {
    layoutProps.push(`p=${node.paddingTop || 0},${node.paddingRight || 0},${node.paddingBottom || 0},${node.paddingLeft || 0}`);
  }
  if (node.primaryAxisAlignItems) layoutProps.push(`alignPrimary=${node.primaryAxisAlignItems}`);
  if (node.counterAxisAlignItems) layoutProps.push(`alignCounter=${node.counterAxisAlignItems}`);
  
  if (layoutProps.length > 0) {
    str += ` | ${layoutProps.join(', ')}`;
  }

  if (node.type === 'VECTOR') {
     str += ' (IS VECTOR/SVG)';
  } else if (node.type === 'TEXT') {
     str += ` (TEXT: "${node.characters}" | font=${node.style?.fontFamily} ${node.style?.fontWeight} ${node.style?.fontSize}px, color=${node.fills?.[0]?.color ? JSON.stringify(node.fills[0].color) : 'none'})`;
  } else if (node.type === 'INSTANCE' && node.name.includes('lucide')) {
     str += ' (ICON INSTANCE)';
  }

  let childrenStr = '';
  if (node.children && depth < 6) { // Limit depth to prevent massive output
    childrenStr = '\n' + node.children.map(c => getLayout(c, depth + 1)).join('\n');
  } else if (node.children && depth >= 6) {
    childrenStr = '\n' + indent + '  ...';
  }
  return str + childrenStr;
}

if (homeNode) {
  fs.writeFileSync('home_layout.txt', getLayout(homeNode));
  console.log('Found 1. home, wrote to home_layout.txt');
} else {
  console.log('Home frame not found');
}
