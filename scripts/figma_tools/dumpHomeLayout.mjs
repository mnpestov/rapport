import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

let homeNode = null;
function findHome(node) {
  if (node.name && (node.name.toLowerCase() === 'home' || node.name.toLowerCase() === 'catalog' || node.name.toLowerCase() === '1. home')) {
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
  if (node.itemSpacing) layoutProps.push(`gap=${node.itemSpacing}`);
  if (node.paddingTop) layoutProps.push(`pt=${node.paddingTop}`);
  if (node.paddingRight) layoutProps.push(`pr=${node.paddingRight}`);
  if (node.paddingBottom) layoutProps.push(`pb=${node.paddingBottom}`);
  if (node.paddingLeft) layoutProps.push(`pl=${node.paddingLeft}`);
  if (node.primaryAxisAlignItems) layoutProps.push(`alignPrimary=${node.primaryAxisAlignItems}`);
  if (node.counterAxisAlignItems) layoutProps.push(`alignCounter=${node.counterAxisAlignItems}`);
  
  if (layoutProps.length > 0) {
    str += ` | ${layoutProps.join(', ')}`;
  }

  if (node.type === 'VECTOR') {
     str += ' (IS VECTOR/SVG)';
  } else if (node.type === 'TEXT') {
     str += ` (TEXT: "${node.characters}" | font=${node.style?.fontFamily} ${node.style?.fontWeight} ${node.style?.fontSize}px)`;
  } else if (node.type === 'INSTANCE' && node.name.includes('lucide')) {
     str += ' (ICON INSTANCE)';
  }

  let childrenStr = '';
  if (node.children) {
    childrenStr = '\n' + node.children.map(c => getLayout(c, depth + 1)).join('\n');
  }
  return str + childrenStr;
}

if (homeNode) {
  fs.writeFileSync('home_layout.txt', getLayout(homeNode));
  console.log('Found Home, wrote to home_layout.txt');
} else {
  console.log('Home frame not found');
}
