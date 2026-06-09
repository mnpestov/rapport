const fs = require('fs');

const data = fs.readFileSync('/Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/ExportBlock-f73bf787-66ed-458a-951f-2ff3cd019a16-Part-1/Бот Агрегатор описаний/Бот Список описаний 36ff2e68acf080449c65f01a3f8dedae_all.csv', 'utf8');

const lines = data.split('\n').filter(l => l.trim().length > 0);
const headers = lines[0].split(',');
console.log("Headers:", headers);

const authors = new Set();
const categories = new Set();
const instruments = new Set();
const characteristics = new Set();

let descriptionsCount = 0;

// simple csv parser
const parseCSVLine = (text) => {
  const result = [];
  let inQuotes = false;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      inQuotes = !inQuotes;
    } else if (text[i] === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += text[i];
    }
  }
  result.push(cur.trim());
  return result;
}

const extractList = (str) => {
  if (!str) return [];
  // remove trailing/leading quotes if any
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.substring(1, str.length - 1);
  }
  return str.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
};

for (let i = 1; i < lines.length; i++) {
  const line = parseCSVLine(lines[i]);
  if (line.length < 7) continue;
  
  descriptionsCount++;
  
  const title = line[0];
  const img = line[1];
  const url = line[2];
  const author = line[3];
  const inst = line[4];
  const cat = line[5];
  const char = line[6];
  
  if (author) authors.add(author.trim());
  
  const insts = extractList(inst);
  insts.forEach(x => instruments.add(x));
  
  const cats = extractList(cat);
  cats.forEach(x => categories.add(x));
  
  const chars = extractList(char);
  chars.forEach(x => characteristics.add(x));
}

console.log(`Descriptions: ${descriptionsCount}`);
console.log(`Unique Authors: ${authors.size}`);
console.log(`Unique Categories: ${categories.size}`);
console.log(`Unique Instruments: ${instruments.size}`);
console.log(`Unique Characteristics: ${characteristics.size}`);

console.log("Categories list:", Array.from(categories));
console.log("Instruments list:", Array.from(instruments));
