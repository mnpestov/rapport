import { Request, Response, NextFunction } from "express";
import { UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";

declare global {
  namespace Express {
    interface Request {
      userRole?: UserRole | null;
    }
  }
}

/**
 * Soft role attach for PUBLIC routes that need to vary their response by
 * role without blocking anyone — unlike requireAdmin (hard 401/403 gate for
 * /admin/*), this never rejects a request: req.userRole is just `null` for
 * guests/regular users, and handlers decide what to omit.
 *
 * Role is resolved from the database rather than trusted from the JWT: the
 * mini-app access token lives up to 24h (refresh up to 30d), so a claim
 * baked into the token would reflect a role change only after
 * re-authentication. A cache-backed DB read gives near-instant effect for
 * promote/demote during testing (see PAID_TIER_ROLLOUT_PLAN.md §2.3/§3.1).
 *
 * Must run after softAuth (relies on req.user.userId when present — softAuth
 * is mounted globally in index.ts, so it always has already run here).
 */
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { role: UserRole | null; expiresAt: number }>();

export const resolveRole = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    req.userRole = null;
    next();
    return;
  }

  const cached = roleCache.get(req.user.userId);
  if (cached && cached.expiresAt > Date.now()) {
    req.userRole = cached.role;
    next();
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { role: true },
    });
    req.userRole = user?.role ?? null;
  } catch (error) {
    console.error("[resolveRole] Failed to resolve role:", error);
    // Fail closed — treat as a regular user rather than blocking the request.
    req.userRole = null;
  }

  roleCache.set(req.user.userId, { role: req.userRole, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  next();
};
