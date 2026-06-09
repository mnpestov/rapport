import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

function rgbToHex(color) {
  if (!color) return '';
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function getFillColor(node) {
  if (node.fills && node.fills.length > 0 && node.fills[0].type === 'SOLID') {
    return rgbToHex(node.fills[0].color);
  }
  return 'none';
}

function extractNode(node, name) {
  return {
    name: name || node.name,
    width: node.absoluteBoundingBox?.width,
    height: node.absoluteBoundingBox?.height,
    cornerRadius: node.cornerRadius !== undefined ? node.cornerRadius : 0,
    paddingTop: node.paddingTop || 0,
    paddingRight: node.paddingRight || 0,
    paddingBottom: node.paddingBottom || 0,
    paddingLeft: node.paddingLeft || 0,
    gap: node.itemSpacing || 0,
    fontSize: node.style?.fontSize,
    fontWeight: node.style?.fontWeight,
    lineHeightPx: node.style?.lineHeightPx,
    fontFamily: node.style?.fontFamily,
    color: getFillColor(node),
    rawName: node.name,
    characters: node.characters
  };
}

const results = [];

function search(node) {
  const n = node.name ? node.name.toLowerCase() : '';
  const text = node.characters ? node.characters.toLowerCase() : '';
  
  if (n === 'item') results.push(extractNode(node, 'Карточка описания'));
  if (n === '🖼️ image') results.push(extractNode(node, 'Изображение карточки'));
  if (text.includes('бесплатно')) results.push(extractNode(node, 'Текст бейджа "Бесплатно"'));
  if (n === 'lucide/heart' || n === 'heart') results.push(extractNode(node, 'Кнопка избранного'));
  if (n === 'input field') results.push(extractNode(node, 'Строка поиска'));
  
  if (node.children) {
    node.children.forEach(search);
  }
}

search(data.document);

// Helper to find the parent badge container for "Бесплатно"
function searchParentBadge(node, parent) {
  const text = node.characters ? node.characters.toLowerCase() : '';
  if (text.includes('бесплатно')) {
    if (parent) {
      results.push(extractNode(parent, 'Бейдж "Бесплатно" (Контейнер)'));
    }
  }
  if (node.children) {
    node.children.forEach(c => searchParentBadge(c, node));
  }
}
searchParentBadge(data.document, null);

// remove duplicates by rawName + width + height
const unique = [];
const seen = new Set();
for (const r of results) {
  const key = `${r.name}-${r.width}-${r.height}-${r.characters || ''}`;
  if (!seen.has(key)) {
    seen.add(key);
    unique.push(r);
  }
}

console.log(JSON.stringify(unique, null, 2));
