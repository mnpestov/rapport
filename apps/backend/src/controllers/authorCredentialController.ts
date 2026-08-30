import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { Permission, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import { sendCredentials, sendResendCredentials } from "../services/authorNotifier";
import { resolveUniqueLogin, generateTempPassword, normalizeP2002Target } from "../utils/authorCredentialHelpers";

// ---------------------------------------------------------------------------
// Shared write path for granting author-cabinet access — used by both
// approveAuthorApplication (authorApplicationController.ts, with the
// AuthorApplication update alongside it) and grantAuthorCredentials below
// (no application involved). Kept as one function so the two callers can
// never drift apart — see implementation_plan.md §4.5 note.
// ---------------------------------------------------------------------------
export async function issueCredentials(
  tx: Prisma.TransactionClient,
  params: { userId: string; authorId: string; login: string; passwordHash: string; adminUserId: string }
): Promise<void> {
  const { userId, authorId, login, passwordHash, adminUserId } = params;

  await tx.user.update({
    where: { id: userId },
    data: { role: UserRole.AUTHOR, authorId },
  });

  await tx.userPermission.upsert({
    where: { userId_permission: { userId, permission: Permission.AUTHOR_CABINET } },
    create: { userId, permission: Permission.AUTHOR_CABINET },
    update: {},
  });

  await tx.authorCredential.upsert({
    where: { userId },
    create: { userId, login, passwordHash, mustChangePassword: true, createdById: adminUserId },
    update: { passwordHash, mustChangePassword: true },
  });
}

// POST /admin/author-credentials — grant access directly, without an
// AuthorApplication (scenario C in implementation_plan.md §4.5: an Author
// already has a linked User, but no credential yet).
export const grantAuthorCredentials = async (req: Request, res: Response): Promise<void> => {
  const { userId, authorId: bodyAuthorId, createAuthorName } = req.body ?? {};
  const adminUserId = req.user!.userId;

  if (typeof userId !== "string" || !userId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { credential: true, author: { select: { id: true, name: true } } },
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (user.role === UserRole.ADMIN) {
      res.status(400).json({ error: "Cannot grant author cabinet access to an admin" });
      return;
    }
    if (user.credential) {
      res.status(409).json({ error: "credential already exists" });
      return;
    }

    // Exactly one source of the author name must be available.
    let resolvedAuthorName: string | undefined;
    if (typeof bodyAuthorId === "string" && bodyAuthorId) {
      const author = await prisma.author.findUnique({ where: { id: bodyAuthorId }, select: { name: true } });
      if (!author) {
        res.status(404).json({ error: "Author not found" });
        return;
      }
      resolvedAuthorName = author.name;
    } else if (typeof createAuthorName === "string" && createAuthorName.trim()) {
      resolvedAuthorName = createAuthorName.trim();
    } else if (user.author) {
      resolvedAuthorName = user.author.name;
    }

    if (!resolvedAuthorName) {
      res.status(400).json({ error: "provide authorId, createAuthorName, or ensure user has a linked author" });
      return;
    }

    // Guard against silently relinking a user already tied to a different author.
    if (user.authorId && bodyAuthorId && user.authorId !== bodyAuthorId) {
      res.status(409).json({ error: "user already linked to a different author" });
      return;
    }

    const login = await resolveUniqueLogin(generateSlug(resolvedAuthorName));
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.$transaction(async (tx) => {
      let authorId = bodyAuthorId ?? user.authorId ?? null;
      if (!authorId && createAuthorName) {
        const newAuthor = await tx.author.create({ data: { name: createAuthorName.trim() } });
        authorId = newAuthor.id;
      }
      if (!authorId) {
        // Shouldn't happen given the checks above, but keeps issueCredentials'
        // required `authorId: string` param honest.
        throw new Error("Unable to resolve authorId");
      }

      await issueCredentials(tx, { userId, authorId, login, passwordHash, adminUserId });
    });

    sendCredentials(user.telegramId, login, tempPassword).catch(console.error);

    res.status(201).json({ success: true, login });
  } catch (error: any) {
    if (error.code === "P2002") {
      const target = normalizeP2002Target(error);
      if (target.includes("login") || target.some((t) => t.includes("AuthorCredential"))) {
        res.status(409).json({ error: "Login conflict — adjust login and retry" });
        return;
      }
      if (target.includes("userId") || target.some((t) => t.includes("AuthorCredential_userId"))) {
        // TOCTOU: two concurrent grant requests for the same user.
        res.status(409).json({ error: "credential already exists" });
        return;
      }
      if (target.includes("authorId") || target.some((t) => t.includes("User_authorId"))) {
        res.status(409).json({ error: "This author is already linked to another user" });
        return;
      }
      if (target.includes("name") || target.some((t) => t.includes("Author_name"))) {
        res.status(409).json({ error: "Author with this name already exists — link explicitly via authorId" });
        return;
      }
    }
    console.error("[AuthorCredential] grantAuthorCredentials failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// DELETE /admin/author-credentials/:userId — "Отозвать пароль": removes only
// password-auth. Telegram OTP access remains; JWTs issued before this call
// still work until they expire naturally (up to 24h).
export const revokePassword = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    await prisma.authorCredential.delete({ where: { userId } });
    res.json({ success: true });
  } catch (error: any) {
    if (error.code === "P2025") {
      res.status(404).json({ error: "credential not found" });
      return;
    }
    console.error("[AuthorCredential] revokePassword failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/author-credentials/:userId/resend-credentials — issue a fresh
// temp password for an existing credential (e.g. the author lost the
// original message). Also the recovery path if the fire-and-forget
// notification from approve/grant silently failed to deliver.
export const resendCredentials = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    const existing = await prisma.authorCredential.findUnique({ where: { userId } });
    if (!existing) {
      res.status(404).json({ error: "credential not found" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    await prisma.authorCredential.update({
      where: { userId },
      data: { passwordHash, mustChangePassword: true, lockedUntil: null },
    });

    sendResendCredentials(user.telegramId, existing.login, tempPassword).catch(console.error);

    res.json({ success: true, login: existing.login });
  } catch (error) {
    console.error("[AuthorCredential] resendCredentials failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/author-credentials/:userId/revoke-access — "Отозвать доступ":
// full revocation. Removes password-auth AND the AUTHOR_CABINET permission,
// demotes the role back to USER (never touches ADMIN), and revokes every
// active refresh token (which also ends the user's Mini App sessions — an
// accepted side effect, see implementation_plan.md §4.6).
export const revokeAccess = async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (user.role === UserRole.AUTHOR) {
        await tx.user.update({ where: { id: userId }, data: { role: UserRole.USER, authorId: null } });
      }
      // deleteMany rather than delete — no-op (not P2025) if credential was
      // already removed, e.g. by a previous "Отозвать пароль" call.
      await tx.authorCredential.deleteMany({ where: { userId } });
      await tx.userPermission.deleteMany({ where: { userId, permission: Permission.AUTHOR_CABINET } });
      await tx.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true, revokedAt: new Date() } });
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[AuthorCredential] revokeAccess failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
