const fs = require('fs');
const path = require('path');

const exportDir = '/Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/ExportBlock-f73bf787-66ed-458a-951f-2ff3cd019a16-Part-1/Бот Агрегатор описаний';
const csvPath = path.join(exportDir, 'Бот Список описаний 36ff2e68acf080449c65f01a3f8dedae_all.csv');

const data = fs.readFileSync(csvPath, 'utf8');
const lines = data.split('\n').filter(l => l.trim().length > 0);
const headers = lines[0].split(',');

// Simple csv parser
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
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.substring(1, str.length - 1);
  }
  return str.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
};

// Check image files
const imageFiles = new Set(fs.readdirSync(exportDir).filter(f => f.endsWith('.jpg') || f.endsWith('.png') || f.endsWith('.jpeg')));

let missingImages = [];
const normalized10 = [];

for (let i = 1; i < lines.length; i++) {
  const line = parseCSVLine(lines[i]);
  if (line.length < 7) continue;
  
  const rawTitle = line[0];
  const rawImg = line[1];
  const url = line[2];
  const rawAuthor = line[3];
  const rawInst = line[4];
  const rawCat = line[5];
  const rawChar = line[6];
  
  // Normalization
  const title = rawTitle.replace(/^["'\s]+|["'\s]+$/g, '').trim(); // Remove surrounding quotes and spaces
  const author = rawAuthor.replace(/^["'\s]+|["'\s]+$/g, '').trim();
  const instruments = extractList(rawInst);
  const categories = extractList(rawCat);
  const characteristics = extractList(rawChar);
  
  // isFree determination
  const isFree = characteristics.includes('бесплатно');
  const tags = characteristics.filter(c => c !== 'бесплатно');

  // Image linking
  // rawImg might be "Бот Агрегатор описаний/filename.jpg" encoded.
  let expectedFilename = decodeURIComponent(rawImg.split('/').pop() || '');
  let imageExists = imageFiles.has(expectedFilename);
  
  if (!imageExists && expectedFilename) {
    missingImages.push({ title, expectedFilename });
  }

  if (normalized10.length < 10) {
    normalized10.push({
      title,
      author,
      url,
      instruments,
      categories,
      tags,
      isFree,
      imageFile: expectedFilename,
      imageExists
    });
  }
}

console.log("=== 10 Normalized ===");
console.log(JSON.stringify(normalized10, null, 2));

console.log("\n=== Missing Images ===");
console.log(`Total missing: ${missingImages.length}`);
console.log(missingImages.slice(0, 10));

