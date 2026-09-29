import { UserRole, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";

/**
 * Общий флаг доступа для хранилища пряжи И для вязальных проектов
 * (PROJECTS_PLAN.md §2.0 — та же премиум-модель, не отдельная фича).
 * Вынесено из stashController.ts, где раньше жила локально — второй
 * потребитель появился с projectsController.ts.
 *
 * Роль читается из БД, никогда из req.user (JwtPayload не содержит role —
 * тот же класс бага, что уже задокументирован в loadOwnedSkein.ts).
 */
export async function hasUnlimitedStashAccess(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      permissions: { where: { permission: Permission.PREMIUM_YARN_STASH }, select: { id: true } },
    },
  });
  return user?.role === UserRole.ADMIN || (user?.permissions.length ?? 0) > 0;
}
