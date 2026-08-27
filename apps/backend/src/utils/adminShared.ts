import { prisma } from "../prismaClient";

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
