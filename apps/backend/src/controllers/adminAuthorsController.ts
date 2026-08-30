import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// AUTHORS CRUD

export const getAuthors = async (req: Request, res: Response): Promise<void> => {
  try {
    const search = req.query.search as string;
    const where = search ? { name: { contains: search, mode: "insensitive" as any } } : undefined;

    const authors = await prisma.author.findMany({
      where,
      include: {
        _count: {
          select: { patterns: true }
        },
        // Powers the "Кабинет" section in the edit modal
        // (implementation_plan.md §8): whether this author has a linked
        // User at all, and whether that User has password-auth set up.
        user: {
          select: {
            id: true,
            credential: {
              select: { login: true, lastLoginAt: true, mustChangePassword: true, lockedUntil: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' }
    });

    const mapped = authors.map(a => ({
      id: a.id,
      name: a.name,
      site: a.site,
      patternsCount: a._count.patterns,
      cabinet: a.user
        ? {
            userId: a.user.id,
            credential: a.user.credential
              ? {
                  login: a.user.credential.login,
                  lastLoginAt: a.user.credential.lastLoginAt?.toISOString() ?? null,
                  mustChangePassword: a.user.credential.mustChangePassword,
                  locked: !!a.user.credential.lockedUntil && a.user.credential.lockedUntil > new Date(),
                }
              : null,
          }
        : null,
    }));

    res.json(mapped);
  } catch (error) {
    console.error("[Admin] getAuthors failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, site } = req.body;
    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.create({
      data: { name, site: site || null }
    });
    res.status(201).json(author);
  } catch (error: any) {
    console.error("[Admin] createAuthor failed:", error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Author with this name already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, site } = req.body;

    if (!name) {
      res.status(400).json({ error: "Name is required" });
      return;
    }

    const author = await prisma.author.update({
      where: { id },
      data: { name, site: site || null }
    });
    res.json(author);
  } catch (error: any) {
    console.error("[Admin] updateAuthor failed:", error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: "Author with this name already exists" });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteAuthor = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const count = await prisma.pattern.count({
      where: { authorId: id }
    });

    if (count > 0) {
      res.status(400).json({ error: `Cannot delete author. There are ${count} related patterns.` });
      return;
    }

    await prisma.author.delete({
      where: { id }
    });
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] deleteAuthor failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
