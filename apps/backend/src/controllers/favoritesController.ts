import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// GET /favorites — returns patternId[] for the authenticated user
export const getFavorites = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const favorites = await prisma.userFavorite.findMany({
      where: { userId },
      select: { patternId: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ patternIds: favorites.map((f: { patternId: string }) => f.patternId) });
  } catch (error) {
    console.error("[Favorites] Failed to get favorites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /favorites/:patternId — add a single pattern to favorites
export const addFavorite = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.params;

  try {
    // Verify pattern exists
    const pattern = await prisma.pattern.findUnique({ where: { id: patternId } });
    if (!pattern) {
      res.status(404).json({ error: "Pattern not found" });
      return;
    }

    await prisma.userFavorite.upsert({
      where: { userId_patternId: { userId, patternId } },
      update: {}, // no-op if already exists
      create: { userId, patternId },
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Favorites] Failed to add favorite:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /favorites/:patternId — remove a single pattern from favorites
export const removeFavorite = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.params;

  try {
    await prisma.userFavorite.deleteMany({
      where: { userId, patternId },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("[Favorites] Failed to remove favorite:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /favorites/import — bulk import patternIds from localStorage migration
export const importFavorites = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternIds } = req.body;

  if (!Array.isArray(patternIds)) {
    res.status(400).json({ error: "patternIds must be an array" });
    return;
  }

  // Filter to strings only, cap at 500 to prevent abuse
  const validIds: string[] = patternIds
    .filter((id): id is string => typeof id === "string")
    .slice(0, 500);

  if (validIds.length === 0) {
    res.json({ imported: 0 });
    return;
  }

  try {
    // Verify which patterns actually exist in DB
    const existingPatterns = await prisma.pattern.findMany({
      where: { id: { in: validIds } },
      select: { id: true },
    });
    const existingIds = existingPatterns.map((p) => p.id);

    const result = await prisma.userFavorite.createMany({
      data: existingIds.map((patternId) => ({ userId, patternId })),
      skipDuplicates: true,
    });

    res.json({ imported: result.count });
  } catch (error) {
    console.error("[Favorites] Failed to import favorites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
