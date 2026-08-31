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

export interface IssueCredentialsResult {
  // true — у пользователя УЖЕ была учётка (он завёл её сам через бота), и мы
  // её не тронули. Вызывающий по этому флагу решает, слать ли пользователю
  // сообщение с логином/паролем: слать нечего, пароль остался прежним и
  // сервер его не знает (BROWSER_ACCESS_PLAN.md §4.1).
  credentialUnchanged: boolean;
  // Актуальный логин — существующий либо только что созданный. Возвращается,
  // чтобы вызывающий мог показать его админу в ответе.
  login: string;
}
export async function issueCredentials(
  tx: Prisma.TransactionClient,
  params: { userId: string; authorId: string; login: string; passwordHash: string; adminUserId: string }
): Promise<IssueCredentialsResult> {
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

  // Раньше здесь был upsert с `update: { passwordHash, mustChangePassword: true }`
  // — он молча перезатирал пароль. Пока учётки были только авторскими, это
  // было безобидно (единственный путь их создания — эта же функция). С
  // браузерным доступом пользователь заводит логин/пароль сам через бота
  // ДО того, как его одобрят автором, и перезапись отобрала бы у него
  // рабочий пароль, вернув временный (BROWSER_ACCESS_PLAN.md §4.1, I7).
  //
  // Поэтому: существующую учётку не трогаем вообще — ни passwordHash, ни
  // login. Выдача авторства добавляет только права (AUTHOR_CABINET + роль +
  // authorId), что и делают два вызова выше.
  const existing = await tx.userCredential.findUnique({
    where: { userId },
    select: { login: true },
  });

  if (existing) {
    return { credentialUnchanged: true, login: existing.login };
  }

  await tx.userCredential.create({
    data: { userId, login, passwordHash, mustChangePassword: true, createdById: adminUserId },
  });

  return { credentialUnchanged: false, login };
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
    // Раньше здесь стоял 409 "credential already exists": пока учётки были
    // только авторскими, наличие учётки означало, что авторство уже выдано,
    // и повторная выдача была ошибкой. С браузерным доступом это перестало
    // быть правдой — пользователь заводит логин сам через бота задолго до
    // того, как подаст заявку на авторство (BROWSER_ACCESS_PLAN.md §4.1).
    // Отбивать такого 409 значило бы, что самостоятельно заведённая учётка
    // НАВСЕГДА закрывает путь в авторы.
    //
    // Теперь выдача авторства просто добавляет права поверх существующей
    // учётки; issueCredentials её не трогает и сообщает об этом через
    // credentialUnchanged (пароль остаётся тот, что пользователь уже знает,
    // и слать ему нечего).

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

    const result = await prisma.$transaction(async (tx) => {
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

      return issueCredentials(tx, { userId, authorId, login, passwordHash, adminUserId });
    });

    // Учётка уже была (пользователь завёл её сам через бота) — пароль не
    // менялся, слать ему нечего. Админу возвращаем credentialUnchanged,
    // чтобы карточка показала «пароль не менялся» вместо «креды отправлены».
    if (!result.credentialUnchanged) {
      sendCredentials(user.telegramId, result.login, tempPassword).catch(console.error);
    }

    res.status(201).json({
      success: true,
      login: result.login,
      credentialUnchanged: result.credentialUnchanged,
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      const target = normalizeP2002Target(error);
      if (target.includes("login") || target.some((t) => t.includes("UserCredential"))) {
        res.status(409).json({ error: "Login conflict — adjust login and retry" });
        return;
      }
      if (target.includes("userId") || target.some((t) => t.includes("UserCredential_userId"))) {
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
    await prisma.userCredential.delete({ where: { userId } });
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
    const existing = await prisma.userCredential.findUnique({ where: { userId } });
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

    await prisma.userCredential.update({
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
      await tx.userCredential.deleteMany({ where: { userId } });
      await tx.userPermission.deleteMany({ where: { userId, permission: Permission.AUTHOR_CABINET } });
      await tx.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true, revokedAt: new Date() } });
      // Вместе с токенами гасим и веб-сессии: enforceWebSubscription смотрит
      // на WebSession.revoked, и живая сессия пережила бы отзыв доступа.
      await tx.webSession.updateMany({ where: { userId, revoked: false }, data: { revoked: true, revokedAt: new Date() } });
    });

    res.json({ success: true });
  } catch (error) {
    console.error("[AuthorCredential] revokeAccess failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
