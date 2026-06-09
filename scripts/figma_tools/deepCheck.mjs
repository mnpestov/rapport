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

function getStrokeColor(node) {
  if (node.strokes && node.strokes.length > 0 && node.strokes[0].type === 'SOLID') {
    return rgbToHex(node.strokes[0].color);
  }
  return 'none';
}

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

function analyzeItem(itemNode) {
  console.log('--- Анализ Карточки (Item) ---');
  console.log(`Фон карточки (fills): ${getFillColor(itemNode)}`);
  console.log(`Скругление карточки: ${itemNode.cornerRadius}`);
  console.log('Дочерние узлы:');
  itemNode.children?.forEach(c => {
    console.log(`- ${c.name}: type=${c.type}, fills=${getFillColor(c)}, radius=${c.cornerRadius}`);
  });
}

function analyzeHeart(node) {
  if (node.name === 'lucide/heart') {
    console.log(`\n--- Анализ Кнопки избранного ---`);
    console.log(`Фон контейнера: ${getFillColor(node)}`);
    if (node.children) {
      node.children.forEach(c => {
        console.log(`Вложенный узел: ${c.name}, stroke=${getStrokeColor(c)}, fill=${getFillColor(c)}`);
      });
    }
  }
  if (node.children) node.children.forEach(analyzeHeart);
}

function analyzeBadge(node, imageNode) {
  if (node.name === 'Label' && node.children && node.children.some(c => c.characters === 'Бесплатно')) {
    console.log(`\n--- Анализ Бейджа ---`);
    console.log(`Фон: ${getFillColor(node)}`);
    console.log(`Текст: ${getFillColor(node.children.find(c => c.characters === 'Бесплатно'))}`);
    
    if (imageNode && node.absoluteBoundingBox && imageNode.absoluteBoundingBox) {
      const top = node.absoluteBoundingBox.y - imageNode.absoluteBoundingBox.y;
      const left = node.absoluteBoundingBox.x - imageNode.absoluteBoundingBox.x;
      console.log(`Координаты относительно Image: top: ${top}px, left: ${left}px`);
    }
  }
  if (node.children) node.children.forEach(c => analyzeBadge(c, imageNode));
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
  analyzeItem(targetItem);
  const img = findImage(targetItem);
  analyzeHeart(targetItem);
  analyzeBadge(targetItem, img);
}

