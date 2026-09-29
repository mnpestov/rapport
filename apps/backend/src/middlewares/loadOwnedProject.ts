import { Request, Response, NextFunction } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

/**
 * Загрузка владения Project (PROJECTS_PLAN.md §2, вступление) — тот же
 * паттерн, что loadOwnedSkein.ts: единый middleware для всех :id-роутов
 * проекта, 404 (не 403) на чужую запись, ADMIN обходит проверку, роль
 * читается из БД (не из req.user — JwtPayload не содержит role).
 */
declare global {
  namespace Express {
    interface Request {
      project?: Prisma.ProjectGetPayload<Record<string, never>>;
      projectSwatch?: Prisma.ProjectSwatchGetPayload<Record<string, never>>;
      projectDocument?: Prisma.ProjectDocumentGetPayload<Record<string, never>>;
    }
  }
}

export const loadOwnedProject = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, project] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.project.findUnique({ where: { id } }),
    ]);

    if (!project) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && project.userId !== userId) {
      // Чужая запись — 404, не 403: не раскрываем сам факт существования id.
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.project = project;
    next();
  } catch (error) {
    console.error("[loadOwnedProject] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Тот же принцип, для роутов, оперирующих ProjectSwatch по его
 * собственному :id (не по :id родительского Project) — владение
 * проверяется транзитивно через родительский project.
 */
export const loadOwnedProjectSwatch = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, swatch] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.projectSwatch.findUnique({ where: { id }, include: { project: true } }),
    ]);

    if (!swatch) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && swatch.project.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.projectSwatch = swatch;
    req.project = swatch.project;
    next();
  } catch (error) {
    console.error("[loadOwnedProjectSwatch] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Тот же принцип для ProjectDocument по его собственному :id — нужен и
 * для раздачи файла (GET .../file), и для CRUD выделений/удаления самого
 * документа.
 */
export const loadOwnedProjectDocument = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  try {
    const [user, document] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      prisma.projectDocument.findUnique({ where: { id }, include: { project: true } }),
    ]);

    if (!document) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const isAdmin = user?.role === UserRole.ADMIN;
    if (!isAdmin && document.project.userId !== userId) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    req.projectDocument = document;
    req.project = document.project;
    next();
  } catch (error) {
    console.error("[loadOwnedProjectDocument] Failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
