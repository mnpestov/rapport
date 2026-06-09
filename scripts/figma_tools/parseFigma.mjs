import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

function findNodes(node, namesToFind, results) {
  if (namesToFind.some(name => node.name && node.name.toLowerCase().includes(name))) {
    results.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      findNodes(child, namesToFind, results);
    }
  }
}

const interestingNames = [
  'card', 'карточка', 'item', 'product', // pattern card
  'image', 'фото', 'picture', // image
  'badge', 'бесплатно', 'free', // badge
  'favorite', 'избранное', 'heart', 'like', // favorite button
  'title', 'название', // title
  'type', 'secondary', 'instrument', // secondary text
  'grid', 'сетка', 'catalog', 'каталог', // grid/container
  'filter', 'фильтр', 'tab', // filters
  'search', 'поиск', 'input' // search
];

const results = [];
findNodes(data.document, interestingNames, results);

const extractProps = (node) => {
  return {
    name: node.name,
    width: node.absoluteBoundingBox?.width,
    height: node.absoluteBoundingBox?.height,
    cornerRadius: node.cornerRadius,
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    itemSpacing: node.itemSpacing,
    fontSize: node.style?.fontSize,
    fontFamily: node.style?.fontFamily,
    fontWeight: node.style?.fontWeight,
    lineHeightPx: node.style?.lineHeightPx,
  };
};

const processed = results.map(extractProps).filter(p => p.width !== undefined);
fs.writeFileSync('parsed_figma.json', JSON.stringify(processed, null, 2));
console.log('Saved to parsed_figma.json');
