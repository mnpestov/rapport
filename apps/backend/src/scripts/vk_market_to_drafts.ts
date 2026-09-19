/**
 * Одноразовая загрузка товаров VK Market (items.json, собран
 * vk_market_scrape/build_dataset.py) в ЧЕРНОВИКИ автора «Елена Яковлева
 * вяжет» (status: DRAFT) — не в очередь новинок (AuthorSyncItem), а именно
 * туда, где автор сама редактирует/подтверждает перед отправкой на
 * модерацию (submitDraft), у неё есть доступ к кабинету.
 *
 * Отличие от import_to_sync_queue.py (Python, вставляет в AuthorSyncItem):
 * Draft.images обязаны быть уже загружены на сервер в /uploads/patterns/
 * (validateNewImageOrigins — тот же путь, что и обычная загрузка через
 * кабинет/admin/upload), поэтому этот скрипт СНАЧАЛА скачивает все фото с
 * VK, только потом создаёт Draft-записи через Prisma напрямую (в обход
 * HTTP API — тот же уровень доступа, что у остальных src/scripts/*.ts).
 *
 * Фильтр (как и в Python-версии): только товары с «МК»/«мастер-класс» в
 * названии, метка убирается из итогового title.
 *
 * Запуск (из apps/backend, DATABASE_URL уже в .env):
 *   npx tsx src/scripts/vk_market_to_drafts.ts --dry-run
 *   npx tsx src/scripts/vk_market_to_drafts.ts
 */
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "../prismaClient";
import { normalizeQuotes } from "../utils/adminShared";
import { deriveImageUrl } from "../utils/patternImages";
import { generateThumbnailUrl, normalizeUploadedImage } from "../utils/imagePipeline";

const AUTHOR_ID = "76d0621f-74d0-4737-b77a-34fd3d022a96"; // "Елена Яковлева вяжет"
const DATASET_PATH = path.join(__dirname, "vk_market_scrape/items.json");
const UPLOADS_DIR = path.join(__dirname, "../../uploads/patterns");

interface VkItem {
  id: number;
  title: string;
  description: string | null;
  price_rub: number | null;
  category: string | null;
  market_url: string;
  cover_photo: string | null;
  photos: string[];
}

function isMk(title: string): boolean {
  const t = title.toLowerCase();
  return t.startsWith("мк") || t.includes("мастер-класс") || t.includes("мастер класс");
}

function stripMkPrefix(title: string): string {
  let t = title.trim();
  t = t.replace(/^мк\s+/i, "");
  t = t.replace(/^мастер[\s-]?класс\s+/i, "");
  t = t.trim();
  return t || title.trim();
}

// Портирована 1:1 из author_sync_lib/main.py — то же прямое совпадение слова
// в названии + тот же словарь синонимов (включая известный баг с "головной
// убор", не исправляем ради идентичного поведения).
function matchCategoryIds(title: string, categoriesDb: { id: string; name: string }[]): string[] {
  const titleLower = title.toLowerCase();
  const matched: { id: string; name: string }[] = [];
  for (const c of categoriesDb) {
    if (titleLower.includes(c.name.toLowerCase())) matched.push(c);
  }
  if (matched.length === 0) {
    const pick = (names: string[]) => {
      const found = categoriesDb.find((c) => names.includes(c.name.toLowerCase()));
      if (found) matched.push(found);
    };
    if (["top", "топ", "футболка", "майка"].some((w) => titleLower.includes(w))) pick(["топ"]);
    else if (["джемпер", "свитер", "пуловер", "sweater", "jumper"].some((w) => titleLower.includes(w))) pick(["свитер", "джемпер"]);
    else if (["cardigan", "кардиган"].some((w) => titleLower.includes(w))) pick(["кардиган"]);
    else if (["dress", "платье", "сарафан"].some((w) => titleLower.includes(w))) pick(["платье"]);
    else if (["hat", "шапка", "чепчик", "берет", "beanie", "балаклава"].some((w) => titleLower.includes(w))) pick(["головной убор"]);
    else if (["socks", "носки", "гольфы", "следки"].some((w) => titleLower.includes(w))) pick(["носки"]);
    else if (["bag", "сумка", "шоппер", "авоська"].some((w) => titleLower.includes(w))) pick(["сумка"]);
    else if (["vest", "жилет", "безрукавка"].some((w) => titleLower.includes(w))) pick(["жилет"]);
  }
  const seen = new Set<string>();
  return matched.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).map((c) => c.id);
}

async function downloadImage(url: string, filepath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("image/")) throw new Error(`Invalid content-type: ${contentType}`);
  if (!response.body) throw new Error("No response body");
  const writer = fs.createWriteStream(filepath);
  // @ts-ignore (Node 18+ types for Readable.fromWeb)
  await pipeline(Readable.fromWeb(response.body), writer);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const items: VkItem[] = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
  const filtered = items.filter((i) => isMk(i.title));
  console.log(`Всего товаров в датасете: ${items.length}`);
  console.log(`Прошли фильтр «МК/мастер-класс»: ${filtered.length}`);

  const author = await prisma.author.findUnique({ where: { id: AUTHOR_ID } });
  if (!author) {
    console.error(`Author ${AUTHOR_ID} не найден в БД.`);
    process.exit(1);
  }

  const categoriesDb = await prisma.productType.findMany({ select: { id: true, name: true } });

  if (dryRun) {
    console.log("\n--- DRY RUN: файлы не скачиваем, в БД не пишем ---\n");
    for (const item of filtered) {
      const cleanTitle = stripMkPrefix(item.title);
      const catIds = matchCategoryIds(cleanTitle, categoriesDb);
      const catNames = catIds.map((id) => categoriesDb.find((c) => c.id === id)?.name).join(", ") || "(не определена)";
      console.log(`- ${cleanTitle} | категория: ${catNames} | фото: ${item.photos.length}`);
    }
    await prisma.$disconnect();
    return;
  }

  let created = 0;
  for (const item of filtered) {
    // Дедуп против уже существующих черновиков этого автора по url — на
    // случай повторного (частичного) запуска после сбоя посреди скачивания.
    const existing = await prisma.draft.findFirst({ where: { authorId: AUTHOR_ID, url: item.market_url } });
    if (existing) {
      console.log(`Пропущено (уже есть черновик): ${item.title}`);
      continue;
    }

    const cleanTitle = stripMkPrefix(item.title);
    const sourceUrls = item.photos.length > 0 ? item.photos : (item.cover_photo ? [item.cover_photo] : []);
    if (sourceUrls.length === 0) {
      console.error(`Пропущено (нет фото): ${item.title}`);
      continue;
    }

    const images: string[] = [];
    try {
      for (const sourceUrl of sourceUrls.slice(0, 5)) {
        const ext = path.extname(new URL(sourceUrl).pathname) || ".jpg";
        const tmpPath = path.join(UPLOADS_DIR, `tmp-${uuidv4()}${ext}`);
        await downloadImage(sourceUrl, tmpPath);
        // Тот же detail-предел, что и у обычной загрузки через admin/upload
        // (см. normalizeUploadedImage) — VK отдаёт фото разных размеров,
        // некоторые заметно тяжелее приемлемого для карточки описания.
        try {
          const filename = await normalizeUploadedImage(tmpPath, UPLOADS_DIR);
          images.push(`/uploads/patterns/${filename}`);
        } finally {
          fs.unlink(tmpPath, () => {});
        }
      }
    } catch (err) {
      console.error(`Ошибка скачивания фото для «${item.title}»:`, err);
      continue;
    }

    const thumbnailUrl = await generateThumbnailUrl(images[0]);
    const categoryIds = matchCategoryIds(cleanTitle, categoriesDb);

    await prisma.draft.create({
      data: {
        authorId: AUTHOR_ID,
        status: "DRAFT",
        title: normalizeQuotes(cleanTitle),
        url: item.market_url,
        images,
        imageUrl: deriveImageUrl(images),
        thumbnailUrl,
        details: item.description ?? null,
        price: item.price_rub ?? null,
        isFree: false,
        isNew: true,
        categories: categoryIds.length > 0 ? { connect: categoryIds.map((id) => ({ id })) } : undefined,
      },
    });
    created++;
    console.log(`Создан черновик: ${cleanTitle} (${images.length} фото)`);
  }

  console.log(`\nСоздано черновиков: ${created} из ${filtered.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
