import fs from 'fs';
const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

const items = [];
function findItems(node) {
  if (node.name === 'Item' && node.type === 'INSTANCE') {
    items.push(node);
  } else {
    node.children?.forEach(findItems);
  }
}

findItems(data.document);

items.forEach((item, index) => {
  let title = '';
  let imageRef = '';
  let typeTag = '';
  let instrTag = '';
  let isFree = false;
  
  function scan(n) {
    if (n.name === 'Title' && n.type === 'TEXT') {
       if (!title) title = n.characters; // First title is usually the card title
       else if (!typeTag && n.characters.includes('Изделие') || n.characters.includes('Свитер') || n.characters.includes('Одежда')) typeTag = n.characters;
       else instrTag = n.characters;
    }
    if (n.name === '🖼️ Image') {
      if (n.fills && n.fills[0] && n.fills[0].imageRef) {
        imageRef = n.fills[0].imageRef;
      }
    }
    if (n.name === 'Label' && n.type === 'INSTANCE') isFree = true;
    n.children?.forEach(scan);
  }
  scan(item);
  console.log(`Item ${index}:`, { title, imageRef, typeTag, instrTag, isFree });
});
