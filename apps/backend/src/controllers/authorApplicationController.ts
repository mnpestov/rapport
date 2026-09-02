import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { ApplicationStatus, Permission } from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateSlug } from "../utils/slug";
import { sendCredentials, sendNeedsInfo, sendRejected } from "../services/authorNotifier";
import { issueCredentials } from "./authorCredentialController";
import {
  resolveUniqueLogin,
  generateTempPassword,
  normalizeP2002Target,
  validateLogin,
  isLoginAvailable,
} from "../utils/authorCredentialHelpers";

const REAPPLY_COOLDOWN_MS = 24 * 3600 * 1000;
// Черновик заявки без изменений дольше этого срока считается брошенным:
// фоновая задача его удаляет, освобождая логин.
const DRAFT_TTL_MS = 24 * 3600 * 1000;
const MAX_RESOURCES = 10;
const MAX_RESOURCE_LENGTH = 500;
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;
const MAX_USER_RESPONSE_LENGTH = 1000;

interface ApplicationInput {
  authorName: string;
  resources: string[];
}

function parseTelegramId(raw: unknown): bigint | null {
  if (raw === undefined || raw === null) return null;
  try {
    return BigInt(raw as any);
  } catch {
    return null;
  }
}

// Shared validation — used by both the mini-app route (§4.1) and the bot's
// internal route (§4.2). Not just a UX nicety in the bot FSM: an attacker
// hitting /internal/bot/author-application directly (with a valid bot API
// key) must go through the exact same checks a mini-app user would.
function validateApplicationInput(body: any): { ok: true; value: ApplicationInput } | { ok: false; error: string } {
  const authorName = typeof body?.authorName === "string" ? body.authorName.trim() : "";
  if (authorName.length < MIN_NAME_LENGTH || authorName.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `authorName must be ${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters` };
  }

  if (!Array.isArray(body?.resources) || body.resources.length === 0) {
    return { ok: false, error: "At least one resource is required" };
  }
  if (body.resources.length > MAX_RESOURCES) {
    return { ok: false, error: `Maximum ${MAX_RESOURCES} resources` };
  }
  const resources: string[] = [];
  for (const raw of body.resources) {
    if (typeof raw !== "string") {
      return { ok: false, error: "Each resource must be a string" };
    }
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_RESOURCE_LENGTH) {
      return { ok: false, error: `Each resource must be at most ${MAX_RESOURCE_LENGTH} characters` };
    }
    resources.push(trimmed);
  }
  if (resources.length === 0) {
    return { ok: false, error: "At least one resource is required" };
  }

  return { ok: true, value: { authorName, resources } };
}

// Shared pre-checks — no PENDING application already open (partial unique
// index also enforces this at the DB level, this is just the friendly
// early-exit), no AUTHOR_CABINET permission yet, and the 24h cooldown after
// a REJECTED application. Used by both the mini-app and bot creation paths.
async function checkCanApply(userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const hasCabinetAccess = await prisma.userPermission.findUnique({
    where: { userId_permission: { userId, permission: Permission.AUTHOR_CABINET } },
  });
  if (hasCabinetAccess) {
    return { ok: false, status: 400, error: "You already have author cabinet access" };
  }

  const pendingApplication = await prisma.authorApplication.findFirst({
    where: { userId, status: ApplicationStatus.PENDING },
  });
  if (pendingApplication) {
    return { ok: false, status: 409, error: "You already have a pending application" };
  }

  const lastRejected = await prisma.authorApplication.findFirst({
    where: { userId, status: ApplicationStatus.REJECTED },
    orderBy: { processedAt: "desc" },
  });
  // processedAt (not updatedAt) anchors the cooldown — updatedAt can also
  // move on an unrelated adminComment edit after the fact.
  if (lastRejected?.processedAt && Date.now() - lastRejected.processedAt.getTime() < REAPPLY_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "Please wait 24h before reapplying" };
  }

  return { ok: true };
}

async function createApplication(userId: string, input: ApplicationInput) {
  return prisma.authorApplication.create({
    data: {
      userId,
      authorName: input.authorName,
      resources: input.resources,
    },
  });
}

// POST /author-applications — mini app, JWT auth (§4.1)
export const createAuthorApplication = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  const validation = validateApplicationInput(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const canApply = await checkCanApply(userId);
    if (!canApply.ok) {
      res.status(canApply.status).json({ error: canApply.error });
      return;
    }

    const application = await createApplication(userId, validation.value);
    res.status(201).json({ id: application.id, status: application.status });
  } catch (error: any) {
    // Race with the partial unique index: two concurrent submissions from
    // the same user both pass the findFirst check above, then one loses
    // to AuthorApplication_pending_userId_key.
    if (error.code === "P2002") {
      res.status(409).json({ error: "You already have a pending application" });
      return;
    }
    console.error("[AuthorApplication] createAuthorApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// GET /author-applications/me — mini app, JWT auth (§4.1)
export const getMyApplication = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  try {
    const application = await prisma.authorApplication.findFirst({
      // DRAFT — незавершённый черновик из бота, для mini-app он «нет заявки».
      where: { userId, status: { not: ApplicationStatus.DRAFT } },
      orderBy: { createdAt: "desc" },
      select: { status: true, adminComment: true, processedAt: true },
    });

    if (!application) {
      res.json({ application: null });
      return;
    }

    res.json({
      application: {
        status: application.status,
        adminComment: application.adminComment,
        // So the mini app can compute "24h since rejection" client-side for
        // the "reapply" button without a second round trip.
        processedAt: application.processedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    console.error("[AuthorApplication] getMyApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /internal/bot/author-application/reserve-login — bot, requireBotApiKey.
//
// Шаг «логин» в диалоге бота. Пользователь придумал логин — проверяем формат
// и занятость и закрепляем его за черновиком заявки этого пользователя.
// Черновик создаётся здесь, если его ещё нет: имя профиля и ресурсы бот уже
// собрал на предыдущих шагах и присылает вместе с логином.
//
// Идемпотентно по логину: повторный вызов с тем же логином (кнопка
// «Изменить логин» → тот же) просто обновляет черновик.
export const reserveApplicationLogin = async (req: Request, res: Response): Promise<void> => {
  const telegramId = parseTelegramId(req.body?.telegramId);
  if (telegramId === null) {
    res.status(400).json({ error: "telegramId is required and must be numeric" });
    return;
  }

  const loginCheck = validateLogin(req.body?.login);
  if (!loginCheck.ok) {
    res.status(400).json({ error: loginCheck.error });
    return;
  }
  const { login } = loginCheck;

  // Имя и ресурсы для черновика. На этом шаге они уже собраны ботом; при
  // финальной отправке пришлются снова и перезапишутся.
  const draftInput = validateApplicationInput(req.body);
  if (!draftInput.ok) {
    res.status(400).json({ error: draftInput.error });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Общие проверки права на подачу — как при финальной отправке. Нет
    // смысла давать закрепить логин тому, кто и заявку подать не сможет.
    const canApply = await checkCanApply(user.id);
    if (!canApply.ok) {
      res.status(canApply.status).json({ error: canApply.error });
      return;
    }

    // Уже есть учётка (пользователь завёл логин через «вход на сайт»).
    // Свой логин менять нельзя — но черновик всё равно нужно создать, иначе
    // финальная отправка не найдёт заявку. Логин черновика фиксируем на
    // существующем, игнорируя присланный.
    const existingCredential = await prisma.userCredential.findUnique({
      where: { userId: user.id },
      select: { login: true },
    });
    const effectiveLogin = existingCredential?.login ?? login;

    // Проверяем занятость только для НОВОГО логина. Существующий — уже наш.
    if (!existingCredential && !(await isLoginAvailable(effectiveLogin, user.id))) {
      res.status(409).json({ error: "login_taken" });
      return;
    }

    // Черновик у пользователя один (partial unique index по DRAFT+PENDING).
    const draft = await prisma.authorApplication.findFirst({
      where: { userId: user.id, status: ApplicationStatus.DRAFT },
      select: { id: true },
    });

    if (draft) {
      await prisma.authorApplication.update({
        where: { id: draft.id },
        data: {
          desiredLogin: effectiveLogin,
          authorName: draftInput.value.authorName,
          resources: draftInput.value.resources,
        },
      });
    } else {
      await prisma.authorApplication.create({
        data: {
          userId: user.id,
          authorName: draftInput.value.authorName,
          resources: draftInput.value.resources,
          desiredLogin: effectiveLogin,
          status: ApplicationStatus.DRAFT,
        },
      });
    }

    res.json({
      ok: true,
      login: effectiveLogin,
      // Бот показывает пометку «(уже создан)» в сводке.
      preexisting: !!existingCredential,
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      // Гонка: логин заняли между проверкой и записью, либо параллельный
      // reserve-login того же пользователя.
      res.status(409).json({ error: "login_taken" });
      return;
    }
    console.error("[AuthorApplication] reserveApplicationLogin failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /internal/bot/author-application/discard-draft — bot, requireBotApiKey.
// Кнопка «Отмена» на сводке: удаляем черновик, логин освобождается.
export const discardApplicationDraft = async (req: Request, res: Response): Promise<void> => {
  const telegramId = parseTelegramId(req.body?.telegramId);
  if (telegramId === null) {
    res.status(400).json({ error: "telegramId is required and must be numeric" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await prisma.authorApplication.deleteMany({
      where: { userId: user.id, status: ApplicationStatus.DRAFT },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[AuthorApplication] discardApplicationDraft failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /internal/bot/author-application — bot, requireBotApiKey (§4.2).
//
// Финальная отправка. Заявка уже существует как черновик (создан на шаге
// reserve-login) с закреплённым логином — переводим её в PENDING и
// перезаписываем имя/ресурсы финальными значениями.
export const submitBotAuthorApplication = async (req: Request, res: Response): Promise<void> => {
  const telegramId = parseTelegramId(req.body?.telegramId);
  if (telegramId === null) {
    res.status(400).json({ error: "telegramId is required and must be numeric" });
    return;
  }

  const validation = validateApplicationInput(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  // Логин из запроса — для сверки с черновиком (защита от рассинхрона
  // бота и бэкенда).
  const loginCheck = validateLogin(req.body?.login);
  if (!loginCheck.ok) {
    res.status(400).json({ error: loginCheck.error });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const canApply = await checkCanApply(user.id);
    if (!canApply.ok) {
      res.status(canApply.status).json({ error: canApply.error });
      return;
    }

    const draft = await prisma.authorApplication.findFirst({
      where: { userId: user.id, status: ApplicationStatus.DRAFT },
    });
    if (!draft) {
      res.status(409).json({ error: "no_draft" });
      return;
    }
    if (draft.desiredLogin !== loginCheck.login) {
      // Бот и бэкенд разошлись — пусть бот начнёт диалог заново.
      res.status(409).json({ error: "login_mismatch" });
      return;
    }

    const updated = await prisma.authorApplication.update({
      where: { id: draft.id },
      data: {
        authorName: validation.value.authorName,
        resources: validation.value.resources,
        status: ApplicationStatus.PENDING,
      },
    });
    res.status(201).json({ id: updated.id, status: updated.status });
  } catch (error: any) {
    if (error.code === "P2002") {
      res.status(409).json({ error: "You already have a pending application" });
      return;
    }
    console.error("[AuthorApplication] submitBotAuthorApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Фоновая уборка брошенных черновиков: не менялись дольше суток → удаляем,
// логин освобождается. Вызывается по расписанию (см. index.ts).
export async function cleanupAbandonedApplicationDrafts(): Promise<number> {
  const cutoff = new Date(Date.now() - DRAFT_TTL_MS);
  const { count } = await prisma.authorApplication.deleteMany({
    where: { status: ApplicationStatus.DRAFT, updatedAt: { lt: cutoff } },
  });
  if (count > 0) {
    console.log(`[AuthorApplication] cleaned up ${count} abandoned draft(s)`);
  }
  return count;
}

// POST /internal/bot/author-application/respond — bot, requireBotApiKey.
// Lets an applicant reply to a NEEDS_INFO application without spawning a
// duplicate PENDING one (the original bug: the bot's old "Подать повторно"
// button called submitBotAuthorApplication, which only guards against an
// existing PENDING/recent-REJECTED application — NEEDS_INFO fell through
// unguarded, so a "reapply" silently left the NEEDS_INFO application
// abandoned instead of updating it). Updates the existing application
// in place and moves it back to PENDING.
export const respondToApplication = async (req: Request, res: Response): Promise<void> => {
  const { telegramId, userResponse: rawResponse, additionalResources } = req.body ?? {};
  if (telegramId === undefined || telegramId === null) {
    res.status(400).json({ error: "telegramId is required" });
    return;
  }

  let telegramIdBig: bigint;
  try {
    telegramIdBig = BigInt(telegramId);
  } catch {
    res.status(400).json({ error: "telegramId must be numeric" });
    return;
  }

  const userResponse = typeof rawResponse === "string" ? rawResponse.trim() : "";
  const newResources: string[] = [];
  if (additionalResources !== undefined) {
    if (!Array.isArray(additionalResources)) {
      res.status(400).json({ error: "additionalResources must be an array" });
      return;
    }
    for (const raw of additionalResources) {
      if (typeof raw !== "string") {
        res.status(400).json({ error: "Each resource must be a string" });
        return;
      }
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (trimmed.length > MAX_RESOURCE_LENGTH) {
        res.status(400).json({ error: `Each resource must be at most ${MAX_RESOURCE_LENGTH} characters` });
        return;
      }
      newResources.push(trimmed);
    }
  }

  if (!userResponse && newResources.length === 0) {
    res.status(400).json({ error: "Provide userResponse and/or additionalResources" });
    return;
  }
  if (userResponse.length > MAX_USER_RESPONSE_LENGTH) {
    res.status(400).json({ error: `userResponse must be at most ${MAX_USER_RESPONSE_LENGTH} characters` });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId: telegramIdBig } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const application = await prisma.authorApplication.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    if (!application || application.status !== ApplicationStatus.NEEDS_INFO) {
      res.status(409).json({ error: "No application awaiting your response" });
      return;
    }

    const combinedResources = [...application.resources, ...newResources].slice(0, MAX_RESOURCES);

    const updated = await prisma.authorApplication.update({
      where: { id: application.id },
      data: {
        resources: combinedResources,
        userResponse: userResponse || application.userResponse,
        status: ApplicationStatus.PENDING,
      },
    });

    res.json({ id: updated.id, status: updated.status });
  } catch (error) {
    console.error("[AuthorApplication] respondToApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /internal/bot/author-application/status — bot, requireBotApiKey (§4.2)
export const getBotApplicationStatus = async (req: Request, res: Response): Promise<void> => {
  const { telegramId } = req.body ?? {};
  if (telegramId === undefined || telegramId === null) {
    res.status(400).json({ error: "telegramId is required" });
    return;
  }

  let telegramIdBig: bigint;
  try {
    telegramIdBig = BigInt(telegramId);
  } catch {
    res.status(400).json({ error: "telegramId must be numeric" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { telegramId: telegramIdBig } });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [application, credential] = await Promise.all([
      prisma.authorApplication.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, adminComment: true, processedAt: true, desiredLogin: true },
      }),
      // Есть ли уже учётка — боту нужно, чтобы в диалоге заявки решить,
      // спрашивать логин или взять существующий. Отдаём и когда заявки нет.
      prisma.userCredential.findUnique({
        where: { userId: user.id },
        select: { login: true },
      }),
    ]);

    if (!application) {
      res.json({ status: null, existingLogin: credential?.login ?? null });
      return;
    }

    res.json({
      status: application.status,
      adminComment: application.adminComment,
      processedAt: application.processedAt?.toISOString() ?? null,
      // Логин из черновика/заявки — бот показывает его в сводке.
      desiredLogin: application.desiredLogin,
      // Существующий логин пользователя, если учётка уже заведена.
      existingLogin: credential?.login ?? null,
    });
  } catch (error) {
    console.error("[AuthorApplication] getBotApplicationStatus failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ---------------------------------------------------------------------------
// Admin endpoints (§4.3-4.4) — requireAuth + requireAdmin, mounted in
// routes/admin.ts.
// ---------------------------------------------------------------------------

export const getAuthorApplications = async (req: Request, res: Response): Promise<void> => {
  try {
    const statusParam = (req.query.status as string)?.toUpperCase();
    const where: any = {};
    if (statusParam && Object.values(ApplicationStatus).includes(statusParam as ApplicationStatus)) {
      where.status = statusParam;
    } else if (!statusParam) {
      // Default view — admins land on the actionable queue, not the whole history.
      where.status = ApplicationStatus.PENDING;
    }

    const applications = await prisma.authorApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, firstName: true, lastName: true, username: true, telegramId: true } } },
    });

    res.json(
      applications.map((a) => ({
        id: a.id,
        authorName: a.authorName,
        resources: a.resources,
        // Логин, который пользователь выбрал при подаче. Админ видит его
        // и может переопределить в форме одобрения.
        desiredLogin: a.desiredLogin,
        status: a.status,
        adminComment: a.adminComment,
        // The applicant's reply to adminComment (see POST
        // /internal/bot/author-application/respond) — surfaced here so the
        // admin sees it without a separate lookup.
        userResponse: a.userResponse,
        createdAt: a.createdAt.toISOString(),
        processedAt: a.processedAt?.toISOString() ?? null,
        user: {
          id: a.user.id,
          firstName: a.user.firstName,
          lastName: a.user.lastName,
          username: a.user.username,
          telegramId: a.user.telegramId.toString(),
        },
      }))
    );
  } catch (error) {
    console.error("[AuthorApplication] getAuthorApplications failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

class AlreadyProcessedError extends Error {}

// POST /admin/author-applications/:id/approve (§4.4)
export const approveAuthorApplication = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { authorId: bodyAuthorId, createAuthorName, login: bodyLogin } = req.body ?? {};
  const adminUserId = req.user!.userId;

  try {
    const app = await prisma.authorApplication.findUnique({
      where: { id },
      include: { user: { select: { id: true, telegramId: true } } },
    });
    if (!app) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    // Early exit before any heavy/side-effecting work below.
    if (app.status !== ApplicationStatus.PENDING && app.status !== ApplicationStatus.NEEDS_INFO) {
      res.status(409).json({ error: "Application already processed" });
      return;
    }

    // Порядок выбора логина:
    //  1. Логин, который выбрал сам пользователь при подаче (обычный путь).
    //     Он уже закреплён за заявкой, коллизии быть не должно — берём как есть.
    //  2. Логин, введённый администратором в форме одобрения (ручной
    //     override, либо резолв заявок без желаемого логина).
    //  3. Синтез из имени — для старых заявок, поданных до self-serve логина.
    let login: string;
    if (app.desiredLogin) {
      login = app.desiredLogin;
    } else {
      const baseLogin = typeof bodyLogin === "string" && bodyLogin.trim()
        ? generateSlug(bodyLogin.trim())
        : generateSlug(createAuthorName ?? app.authorName);
      login = await resolveUniqueLogin(baseLogin);
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      const fresh = await tx.authorApplication.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== ApplicationStatus.PENDING && fresh.status !== ApplicationStatus.NEEDS_INFO) {
        throw new AlreadyProcessedError();
      }

      let authorId: string | null = bodyAuthorId ?? null;
      if (!authorId) {
        const newAuthor = await tx.author.create({
          data: { name: createAuthorName ?? app.authorName },
        });
        authorId = newAuthor.id;
      }

      const issued = await issueCredentials(tx, {
        userId: app.userId,
        authorId,
        login,
        passwordHash,
        adminUserId,
      });

      await tx.authorApplication.update({
        where: { id },
        data: { status: ApplicationStatus.APPROVED, processedById: adminUserId, processedAt: new Date() },
      });

      return issued;
    });

    // Заявитель мог завести учётку сам через бота ещё до подачи заявки — тогда
    // issueCredentials её не тронул, пароль остался прежним, и слать ему
    // нечего (BROWSER_ACCESS_PLAN.md §4.1, I7).
    if (!result.credentialUnchanged) {
      sendCredentials(app.user.telegramId, result.login, tempPassword).catch(console.error);
    }

    res.json({ success: true, login: result.login, credentialUnchanged: result.credentialUnchanged });
  } catch (error: any) {
    if (error instanceof AlreadyProcessedError) {
      res.status(409).json({ error: "Application already processed" });
      return;
    }
    if (error.code === "P2002") {
      const target = normalizeP2002Target(error);
      if (target.includes("login") || target.some((t) => t.includes("UserCredential"))) {
        res.status(409).json({ error: "Login conflict — adjust login and retry" });
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
    console.error("[AuthorApplication] approveAuthorApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/author-applications/:id/needs-info (§4.3)
export const requestApplicationInfo = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
  const adminUserId = req.user!.userId;

  if (typeof comment !== "string" || !comment.trim()) {
    res.status(400).json({ error: "comment is required" });
    return;
  }

  try {
    const app = await prisma.authorApplication.findUnique({
      where: { id },
      include: { user: { select: { telegramId: true } } },
    });
    if (!app) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (app.status !== ApplicationStatus.PENDING) {
      res.status(409).json({ error: "Application already processed" });
      return;
    }

    await prisma.authorApplication.update({
      where: { id },
      data: { status: ApplicationStatus.NEEDS_INFO, adminComment: comment.trim(), processedById: adminUserId, processedAt: new Date() },
    });

    sendNeedsInfo(app.user.telegramId, comment.trim()).catch(console.error);

    res.json({ success: true });
  } catch (error) {
    console.error("[AuthorApplication] requestApplicationInfo failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /admin/author-applications/:id/reject (§4.3)
export const rejectAuthorApplication = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { comment } = req.body ?? {};
  const adminUserId = req.user!.userId;

  try {
    const app = await prisma.authorApplication.findUnique({
      where: { id },
      include: { user: { select: { telegramId: true } } },
    });
    if (!app) {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (app.status !== ApplicationStatus.PENDING && app.status !== ApplicationStatus.NEEDS_INFO) {
      res.status(409).json({ error: "Application already processed" });
      return;
    }

    await prisma.authorApplication.update({
      where: { id },
      data: {
        status: ApplicationStatus.REJECTED,
        adminComment: typeof comment === "string" && comment.trim() ? comment.trim() : null,
        processedById: adminUserId,
        processedAt: new Date(),
        // Отклонённая заявка логин больше не держит — освобождаем.
        desiredLogin: null,
      },
    });

    sendRejected(app.user.telegramId, typeof comment === "string" ? comment.trim() : null).catch(console.error);

    res.json({ success: true });
  } catch (error) {
    console.error("[AuthorApplication] rejectAuthorApplication failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

