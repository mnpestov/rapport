import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

/**
 * Admin gate. Must run AFTER requireAuth (relies on req.user.userId).
 *
 * Role is resolved from the database rather than trusted from the JWT:
 * tokens live up to 24h, so a role change (revoking admin) takes effect
 * immediately instead of waiting for the token to expire.
 */
export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user || user.role !== UserRole.ADMIN) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  } catch (error) {
    console.error("[requireAdmin] Failed to resolve role:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
