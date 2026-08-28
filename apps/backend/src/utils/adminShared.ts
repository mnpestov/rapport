import { prisma } from "../prismaClient";

// Straight ASCII quotes (") in a title get typeset as Russian angle quotes
// («») instead — applied at every write point (admin create/update, author
// cabinet drafts, moderation's scraper-item → Pattern conversion) so this is
// the ONE place titles ever get this treatment, not a periodic sweep. Was
// previously a standalone /admin/patterns/fix-archive-quotes endpoint that
// re-scanned every Pattern on each admin page load — replaced by fixing the
// source at write time instead (see CODE_REVIEW_BACKLOG.md finding #1).
// Alternates open/close on each straight quote encountered, left to right —
// correct for the common "single pair per title" case; a title with an odd
// number of quotes or unbalanced nesting will still alternate mechanically,
// same limitation the original sweep had.
export function normalizeQuotes(title: string): string {
  let isOpen = true;
  return title.replace(/"/g, () => {
    const q = isOpen ? '«' : '»';
    isOpen = !isOpen;
    return q;
  });
}

// Shared by every admin controller that touches Pattern.url — normalizes
// scheme/host/trailing-slash so the same product page always maps to one
// canonical URL regardless of how it was pasted or scraped.
export function normalizeUrl(urlStr: string): string {
  const trimmed = urlStr.trim();
  try {
    const url = new URL(trimmed);
    url.hostname = url.hostname.toLowerCase();
    let pathname = url.pathname.replace(/\/$/, "");
    if (!pathname) pathname = "/";
    return url.protocol + "//" + url.hostname + pathname + url.search + url.hash;
  } catch (e) {
    return trimmed.toLowerCase().replace(/\/$/, "");
  }
}

// find-or-create helpers with TOCTOU fix: catch P2002 and re-fetch on race.
// syncAuthor is kept for the data import path only — admin pattern forms
// must pass authorId directly (never free-text authorName).
//
// Used by adminPatternsController (create/update pattern), adminModerationController
// (approveDraft) and syncController (author_sync.py's admin-facing endpoints) —
// kept here, not inside any single domain controller, so none of them has to
// import from another's file.

export async function syncAuthor(name: string): Promise<string> {
  const normalized = name.trim().replace(/\s+/g, " ");
  let author = await prisma.author.findFirst({
    where: { name: { equals: normalized, mode: "insensitive" } },
  });
  if (!author) {
    try {
      author = await prisma.author.create({ data: { name: normalized } });
    } catch (e: any) {
      if (e.code === "P2002") {
        author = await prisma.author.findFirst({
          where: { name: { equals: normalized, mode: "insensitive" } },
        });
        if (!author) throw e;
      } else throw e;
    }
  }
  return author.id;
}

export async function syncTags(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.tag.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.tag.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}

export async function syncCategories(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.productType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.productType.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.productType.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}

export async function syncInstruments(names: string[]): Promise<string[]> {
  const normalized = [...new Set(names.map(n => n.trim().replace(/\s+/g, " ")).filter(Boolean))];
  const ids: string[] = [];
  for (const name of normalized) {
    let item = await prisma.instrument.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
    if (!item) {
      try {
        item = await prisma.instrument.create({ data: { name } });
      } catch (e: any) {
        if (e.code === "P2002") {
          item = await prisma.instrument.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
          if (!item) throw e;
        } else throw e;
      }
    }
    ids.push(item.id);
  }
  return ids;
}
