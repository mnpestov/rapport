import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const prisma = new PrismaClient();

const exportDir = '/Users/mihailpestov/Desktop/dev/ai-dev/miniApp_UU/ExportBlock-f73bf787-66ed-458a-951f-2ff3cd019a16-Part-1/Бот Агрегатор описаний';
const csvPath = path.join(exportDir, 'Бот Список описаний 36ff2e68acf080449c65f01a3f8dedae_all.csv');
const publicImagesDir = path.join(__dirname, '..', 'public', 'images', 'patterns');

// Ensure public images dir exists
if (!fs.existsSync(publicImagesDir)) {
  fs.mkdirSync(publicImagesDir, { recursive: true });
}

// Simple csv parser
const parseCSVLine = (text: string) => {
  const result: string[] = [];
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

const extractList = (str: string) => {
  if (!str) return [];
  if (str.startsWith('"') && str.endsWith('"')) {
    str = str.substring(1, str.length - 1);
  }
  return str.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(s => s);
};

// Transliteration map for slugs
const cyrillicToLatinMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya'
};

const transliterate = (text: string) => {
  return text.toLowerCase().split('').map(char => cyrillicToLatinMap[char] || char).join('');
};

const generateSlug = (title: string) => {
  let slug = transliterate(title);
  slug = slug.replace(/#/g, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9\-]/g, '');
  slug = slug.replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = crypto.randomBytes(4).toString('hex');
  return slug;
};

async function main() {
  console.log('Starting import...');
  
  const data = fs.readFileSync(csvPath, 'utf8');
  const lines = data.split('\n').filter(l => l.trim().length > 0);
  
  let importedCount = 0;
  let missingImages = 0;
  let missingImageList: string[] = [];

  // Clear existing data? We want to drop old mock data before importing real.
  console.log('Clearing old data...');
  await prisma.pattern.deleteMany();
  await prisma.author.deleteMany();
  await prisma.productType.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.tag.deleteMany();

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
    const authorName = rawAuthor.replace(/^["'\s]+|["'\s]+$/g, '').trim();
    const instrumentsList = extractList(rawInst);
    const categoriesList = extractList(rawCat);
    const characteristicsList = extractList(rawChar);
    
    const isFree = characteristicsList.some(c => c.toLowerCase() === 'бесплатно');
    const tagsList = characteristicsList.filter(c => c.toLowerCase() !== 'бесплатно');

    let expectedFilename = decodeURIComponent(rawImg.split('/').pop() || '');
    let relativePath = `/images/patterns/${expectedFilename}`;

    // Handle image copying
    let sourcePath = path.join(exportDir, expectedFilename);
    let destPath = path.join(publicImagesDir, expectedFilename);
    
    if (fs.existsSync(sourcePath)) {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(sourcePath, destPath);
      }
    } else if (expectedFilename) {
      missingImages++;
      missingImageList.push(expectedFilename);
    }

    let slug = generateSlug(title);
    
    // Ensure slug uniqueness (if duplicates happen)
    let existingPattern = await prisma.pattern.findUnique({ where: { slug } });
    let suffix = 1;
    while (existingPattern) {
      existingPattern = await prisma.pattern.findUnique({ where: { slug: `${slug}-${suffix}` } });
      if (existingPattern) suffix++;
      else slug = `${slug}-${suffix}`;
    }

    // Upsert Author
    const author = await prisma.author.upsert({
      where: { name: authorName || 'Unknown Author' },
      update: {},
      create: { name: authorName || 'Unknown Author' }
    });

    // Upsert dependencies
    const instrumentConnects = [];
    for (const inst of instrumentsList) {
      const dbInst = await prisma.instrument.upsert({
        where: { name: inst }, update: {}, create: { name: inst }
      });
      instrumentConnects.push({ id: dbInst.id });
    }

    const categoryConnects = [];
    for (const cat of categoriesList) {
      const dbCat = await prisma.productType.upsert({
        where: { name: cat }, update: {}, create: { name: cat }
      });
      categoryConnects.push({ id: dbCat.id });
    }

    const tagConnects = [];
    for (const tag of tagsList) {
      const dbTag = await prisma.tag.upsert({
        where: { name: tag }, update: {}, create: { name: tag }
      });
      tagConnects.push({ id: dbTag.id });
    }

    // Create Pattern
    await prisma.pattern.create({
      data: {
        title,
        slug,
        url,
        imageUrl: relativePath,
        isFree,
        author: { connect: { id: author.id } },
        instruments: { connect: instrumentConnects },
        categories: { connect: categoryConnects },
        tags: { connect: tagConnects }
      }
    });

    importedCount++;
  }

  const authorsCount = await prisma.author.count();
  const productTypesCount = await prisma.productType.count();
  const instrumentsCount = await prisma.instrument.count();
  const tagsCount = await prisma.tag.count();
  const totalImagesFound = fs.readdirSync(publicImagesDir).filter(f => !f.startsWith('.')).length;

  console.log('\\n=== Report ===');
  console.log(`Patterns imported: ${importedCount}`);
  console.log(`Authors created: ${authorsCount}`);
  console.log(`ProductTypes created: ${productTypesCount}`);
  console.log(`Instruments created: ${instrumentsCount}`);
  console.log(`Tags created: ${tagsCount}`);
  console.log(`Images found and copied: ${totalImagesFound}`);
  console.log(`Images missing: ${missingImages}`);
  if (missingImages > 0) {
    console.log('Missing images list:', missingImageList);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
