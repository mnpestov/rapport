import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { prisma } from '../prismaClient';
import { generateSlug } from '../utils/slug';

const csvPath = path.join(__dirname, '../../../../ExportBlock-f73bf787-66ed-458a-951f-2ff3cd019a16-Part-1/Бот Агрегатор описаний/Бот Список описаний 36ff2e68acf080449c65f01a3f8dedae_all.csv');

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

// Transliteration logic moved to src/utils/slug.ts

async function run() {
  console.log("Clearing existing data...");
  await prisma.pattern.deleteMany({});
  await prisma.author.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.instrument.deleteMany({});
  await prisma.productType.deleteMany({});

  const data = fs.readFileSync(csvPath, 'utf8');
  const lines = data.split('\n').filter(l => l.trim().length > 0);
  
  let importedCount = 0;

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
    
    let title = rawTitle.replace(/^["'\s]+|["'\s]+$/g, '').trim(); 
    const authorName = rawAuthor.replace(/^["'\s]+|["'\s]+$/g, '').trim() || 'Unknown Author';
    const instruments = extractList(rawInst);
    const categories = extractList(rawCat);
    const characteristics = extractList(rawChar);
    
    const isFree = characteristics.some(c => c.toLowerCase().includes('бесплатн'));
    const tags = characteristics.filter(c => !c.toLowerCase().includes('бесплатн'));
    
    let expectedFilename = decodeURIComponent(rawImg.split('/').pop() || '');
    let relativePath = `/images/patterns/${expectedFilename}`;
    
    let slug = generateSlug(title);

    // Make sure slug is unique
    const existingPattern = await prisma.pattern.findUnique({ where: { slug } });
    if (existingPattern) {
      slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    }

    // Upsert Author
    const author = await prisma.author.upsert({
      where: { name: authorName },
      update: {},
      create: { name: authorName }
    });

    // Create Pattern
    await prisma.pattern.create({
      data: {
        title,
        slug,
        url,
        imageUrl: relativePath,
        isFree,
        authorId: author.id,
        instruments: {
          connectOrCreate: instruments.map(name => ({
            where: { name },
            create: { name }
          }))
        },
        categories: {
          connectOrCreate: categories.map(name => ({
            where: { name },
            create: { name }
          }))
        },
        tags: {
          connectOrCreate: tags.map(name => ({
            where: { name },
            create: { name }
          }))
        }
      }
    });

    importedCount++;
  }

  console.log(`Successfully imported ${importedCount} patterns!`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
