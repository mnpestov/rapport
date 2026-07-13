import { prisma } from '../src/prismaClient';
import { readFileSync } from 'fs';
import { join } from 'path';

interface AuthorLink {
  name: string;
  platform: string;
}

async function main() {
  const dataPath = join(__dirname, '../prisma/data/authors_links.json');
  const data: AuthorLink[] = JSON.parse(readFileSync(dataPath, 'utf-8'));

  const dbAuthors = await prisma.author.findMany({ select: { id: true, name: true, site: true } });
  const byName = new Map(dbAuthors.map((a) => [a.name.trim().toLowerCase(), a]));

  let updated = 0;
  let alreadySet = 0;
  const unmatched: string[] = [];

  for (const entry of data) {
    const author = byName.get(entry.name.trim().toLowerCase());
    if (!author) {
      unmatched.push(entry.name);
      continue;
    }
    if (author.site === entry.platform) {
      alreadySet++;
      continue;
    }
    await prisma.author.update({ where: { id: author.id }, data: { site: entry.platform } });
    updated++;
  }

  console.log(`Всего записей в файле: ${data.length}`);
  console.log(`Обновлено: ${updated}`);
  console.log(`Уже было актуально: ${alreadySet}`);
  console.log(`Не найдено в БД (${unmatched.length}):`);
  unmatched.forEach((n) => console.log('  -', n));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
