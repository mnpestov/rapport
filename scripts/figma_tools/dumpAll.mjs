import fs from 'fs';

const data = JSON.parse(fs.readFileSync('figma_data.json', 'utf8'));

const results = [];
function dumpAll(node) {
  if (node.name) {
    results.push(`${node.name}: W=${node.absoluteBoundingBox?.width} H=${node.absoluteBoundingBox?.height} R=${node.cornerRadius} PT=${node.paddingTop} PB=${node.paddingBottom} PL=${node.paddingLeft} PR=${node.paddingRight}`);
  }
  if (node.children) {
    for (const child of node.children) {
      dumpAll(child);
    }
  }
}
dumpAll(data.document);

fs.writeFileSync('all_nodes.txt', results.join('\n'));
