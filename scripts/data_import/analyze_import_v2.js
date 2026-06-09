const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const exportDir = '/Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/ExportBlock-f73bf787-66ed-458a-951f-2ff3cd019a16-Part-1/Бот Агрегатор описаний';
const csvPath = path.join(exportDir, 'Бот Список описаний 36ff2e68acf080449c65f01a3f8dedae_all.csv');

const data = fs.readFileSync(csvPath, 'utf8');
const lines = data.split('\n').filter(l => l.trim().length > 0);

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
  return str.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(s => s); // keep case, remove extra spaces
};

// Transliteration map for slugs
const cyrillicToLatinMap = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya'
};

const transliterate = (text) => {
  return text.toLowerCase().split('').map(char => cyrillicToLatinMap[char] || char).join('');
};

const generateSlug = (title) => {
  let slug = transliterate(title);
  // remove #, replace spaces and underscores with -, remove special chars
  slug = slug.replace(/#/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-]/g, '');
  // replace multiple dashes
  slug = slug.replace(/-+/g, '-').replace(/^-|-$/g, '');
  
  if (!slug) slug = crypto.randomBytes(4).toString('hex');
  return slug;
};

let startsWithHash = 0;
let containsHashNotStart = 0;
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
  let title = rawTitle.replace(/^["'\s]+|["'\s]+$/g, '').trim(); 
  const author = rawAuthor.replace(/^["'\s]+|["'\s]+$/g, '').trim();
  const instruments = extractList(rawInst);
  const categories = extractList(rawCat);
  const characteristics = extractList(rawChar);
  
  // Title analysis
  if (title.startsWith('#')) startsWithHash++;
  else if (title.includes('#')) containsHashNotStart++;

  // We propose keeping the '#' in the title for display if it's there. 
  // It acts as a stylist choice by the author. We just clean spaces.

  // isFree determination
  const isFree = characteristics.some(c => c.toLowerCase() === 'бесплатно');
  const tags = characteristics.filter(c => c.toLowerCase() !== 'бесплатно');

  // Image linking
  let expectedFilename = decodeURIComponent(rawImg.split('/').pop() || '');
  let relativePath = `/images/patterns/${expectedFilename}`;

  // Slug
  let slug = generateSlug(title);

  if (normalized10.length < 10) {
    normalized10.push({
      title,
      slug,
      author,
      url,
      instruments,
      categories,
      tags,
      isFree,
      imageUrl: relativePath
    });
  }
}

console.log("=== Title Analysis ===");
console.log(`Total rows processed: ${lines.length - 1}`);
console.log(`Starts with #: ${startsWithHash}`);
console.log(`Contains # but not at start: ${containsHashNotStart}`);

console.log("\n=== 10 Normalized Records ===");
console.log(JSON.stringify(normalized10, null, 2));
