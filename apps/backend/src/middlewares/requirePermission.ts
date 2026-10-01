import { Request, Response, NextFunction } from "express";
import { Permission, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

/**
 * Permission gate. Must run AFTER requireAuth.
 *
 * Checks that the user has the given permission in UserPermission table.
 * Does NOT implicitly grant access to admins — admin routes use requireAdmin.
 */
export const requirePermission = (permission: Permission) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const entry = await prisma.userPermission.findUnique({
        where: { userId_permission: { userId, permission } },
      });
      if (!entry) {
        // warn, не error — ожидаемый отказ (пользователь без фичи
        // попытался её открыть), не баг. При тестовой группе это прямой
        // ответ на "почему у меня не открывается" без воспроизведения
        // вручную — userId + permission + путь запроса.
        console.warn(`[requirePermission] denied userId=${userId} permission=${permission} path=${req.originalUrl}`);
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    } catch (error) {
      console.error(`[requirePermission] failed userId=${userId} permission=${permission}:`, error);
      res.status(500).json({ error: "Internal server error" });
    }
  };

/**
 * Grants access to users who are either ADMIN (by role) OR have the given
 * permission in UserPermission. Used for endpoints shared between admin
 * and author cabinet (e.g. /admin/upload).
 */
export const requirePermissionOrAdmin = (permission: Permission) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          role: true,
          permissions: { where: { permission }, select: { id: true } },
        },
      });
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (user.role === UserRole.ADMIN || user.permissions.length > 0) {
        next();
      } else {
        console.warn(`[requirePermissionOrAdmin] denied userId=${userId} permission=${permission} role=${user.role} path=${req.originalUrl}`);
        res.status(403).json({ error: "Forbidden" });
      }
    } catch (error) {
      console.error(`[requirePermissionOrAdmin] failed userId=${userId} permission=${permission}:`, error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
