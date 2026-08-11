import { Request, Response, NextFunction } from "express";
import { UserRole, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";

export interface PremiumAccess {
  isAdmin: boolean;
  core: boolean;
  extra: boolean;
  details: boolean;
}

declare global {
  namespace Express {
    interface Request {
      premium?: PremiumAccess;
    }
  }
}

/**
 * Soft access attach for PUBLIC routes that need to vary their response by
 * role/permission without blocking anyone — unlike requireAdmin (hard
 * 401/403 gate for /admin/*), this never rejects a request: req.premium is
 * just all-false for guests, and handlers decide what to omit.
 *
 * ADMIN is a superset of all three flags (matches requirePermissionOrAdmin's
 * existing semantics for AUTHOR_CABINET) — an admin never needs an explicit
 * UserPermission row. PREMIUM_CORE/PREMIUM_EXTRA/PREMIUM_DETAILS are resolved
 * from UserPermission rather than trusted from the JWT: the mini-app access token
 * lives up to 24h (refresh up to 30d), so a claim baked into the token would
 * reflect a grant/revoke only after re-authentication. A cache-backed DB
 * read gives near-instant effect for testing (see
 * PAID_TIER_PERMISSIONS_PLAN.md §3.1).
 *
 * Must run after softAuth (relies on req.user.userId when present — softAuth
 * is mounted globally in index.ts, so it always has already run here).
 */
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { premium: PremiumAccess; expiresAt: number }>();

const NO_ACCESS: PremiumAccess = { isAdmin: false, core: false, extra: false, details: false };

export const resolveRole = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    req.premium = NO_ACCESS;
    next();
    return;
  }

  const cached = roleCache.get(req.user.userId);
  if (cached && cached.expiresAt > Date.now()) {
    req.premium = cached.premium;
    next();
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        role: true,
        permissions: {
          where: { permission: { in: [Permission.PREMIUM_CORE, Permission.PREMIUM_EXTRA, Permission.PREMIUM_DETAILS] } },
          select: { permission: true },
        },
      },
    });
    const isAdmin = user?.role === UserRole.ADMIN;
    const perms = new Set(user?.permissions.map((p) => p.permission));
    req.premium = {
      isAdmin,
      core: isAdmin || perms.has(Permission.PREMIUM_CORE),
      extra: isAdmin || perms.has(Permission.PREMIUM_EXTRA),
      details: isAdmin || perms.has(Permission.PREMIUM_DETAILS),
    };
  } catch (error) {
    console.error("[resolveRole] Failed to resolve access:", error);
    // Fail closed — treat as a regular user rather than blocking the request.
    req.premium = NO_ACCESS;
  }

  roleCache.set(req.user.userId, { premium: req.premium, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  next();
};
