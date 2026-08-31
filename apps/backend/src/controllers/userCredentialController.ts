import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { Permission } from "@prisma/client";
import { prisma } from "../prismaClient";
import { generateTempPassword, normalizeLogin, normalizeP2002Target } from "../utils/authorCredentialHelpers";

/**
 * Self-serve учётка для входа в браузерную версию
 * (BROWSER_ACCESS_PLAN.md §3.6, §4.1).
 *
 * До этого учётки выдавал только админ и только авторам. Здесь пользователь
 * заводит её сам через бота: логин придумывает он, пароль генерирует
 * сервер (как у авторов — временный, с обязательной сменой при первом
 * входе).
 *
 * Вызывается ботом за requireBotApiKey. Бот — UX-слой, а не граница
 * безопасности: вся валидация продублирована здесь.
 */

const BCRYPT_COST = 12;

// Логин виден только владельцу и админу, но набирать его человеку — с
// клавиатуры телефона, поэтому латиница/цифры/._- без пробелов. Верхняя
// граница совпадает с той, что уже действует для машинных авторских логинов
// (resolveUniqueLogin), нижняя — чтобы логин нельзя было сделать
// неотличимо коротким.
const LOGIN_MIN = 3;
const LOGIN_MAX = 30;
const LOGIN_RE = /^[a-z0-9._-]+$/;

function validateLogin(raw: unknown): { ok: true; login: string } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "Логин обязателен" };
  }
  const login = normalizeLogin(raw);
  if (login.length < LOGIN_MIN || login.length > LOGIN_MAX) {
    return { ok: false, error: `Логин должен быть от ${LOGIN_MIN} до ${LOGIN_MAX} символов` };
  }
  if (!LOGIN_RE.test(login)) {
    return { ok: false, error: "Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание" };
  }
  return { ok: true, login };
}

function parseTelegramId(raw: unknown): bigint | null {
  if (raw === undefined || raw === null) return null;
  try {
    return BigInt(raw as any);
  } catch {
    return null;
  }
}

/**
 * POST /internal/bot/user-credentials — бот создаёт учётку.
 *
 * telegramId в ТЕЛЕ, не в пути: query и path-параметры попадают в
 * access-логи прокси, и вокруг этого уже выстроена конвенция остальных
 * bot-эндпоинтов (см. routes/internal.ts).
 */
export const createUserCredential = async (req: Request, res: Response): Promise<void> => {
  const telegramId = parseTelegramId(req.body?.telegramId);
  if (telegramId === null) {
    res.status(400).json({ error: "telegramId is required and must be numeric" });
    return;
  }

  const validation = validateLogin(req.body?.login);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const { login } = validation;

  const { username, firstName, lastName } = req.body ?? {};

  try {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_COST);

    const result = await prisma.$transaction(async (tx) => {
      // Пользователь мог ни разу не открывать Mini App — тогда User'а ещё
      // нет, и создаём его прямо здесь по данным из Telegram. Поля
      // намеренно неполные (нет languageCode/isPremium): первый же вход в
      // Mini App дополнит их своим upsert'ом.
      const user = await tx.user.upsert({
        where: { telegramId },
        update: {
          // username мог смениться с прошлого визита — обновляем, от него
          // зависит вход по коду (findUserByUsername).
          username: username ?? undefined,
          firstName: firstName || undefined,
          lastName: lastName ?? undefined,
        },
        create: {
          telegramId,
          firstName: typeof firstName === "string" && firstName ? firstName : "Пользователь",
          lastName: lastName ?? null,
          username: username ?? null,
        },
        select: { id: true },
      });

      // Учётка уже есть — не перезатираем: пароль знает только пользователь,
      // и молча заменить его временным значило бы отобрать доступ. Логин
      // возвращаем, чтобы бот показал его («Мой логин») и предложил сброс.
      const existing = await tx.userCredential.findUnique({
        where: { userId: user.id },
        select: { login: true },
      });
      if (existing) {
        return { created: false as const, login: existing.login };
      }

      await tx.userCredential.create({
        data: {
          userId: user.id,
          login,
          passwordHash,
          mustChangePassword: true,
          // Self-serve: выдавшего админа нет.
          createdById: null,
        },
      });

      // Веб-доступ выдаётся вместе с учёткой — в одной транзакции с ней
      // (BROWSER_ACCESS_PLAN.md §3.5). Сгенерировал логин в боте → можешь
      // войти; иначе пользователь получил бы креды, которые не работают.
      await tx.userPermission.upsert({
        where: { userId_permission: { userId: user.id, permission: Permission.WEB_ACCESS } },
        create: { userId: user.id, permission: Permission.WEB_ACCESS },
        update: {},
      });

      return { created: true as const, login };
    });

    if (!result.created) {
      res.status(409).json({ error: "credential_exists", login: result.login });
      return;
    }

    // Пароль возвращается ботy ровно один раз — в БД лежит только хэш, и
    // восстановить его потом нельзя (только сбросить).
    res.status(201).json({ login: result.login, password: tempPassword });
  } catch (error: any) {
    if (error.code === "P2002") {
      const target = normalizeP2002Target(error);
      if (target.includes("login") || target.some((t) => t.includes("UserCredential_login"))) {
        res.status(409).json({ error: "login_taken" });
        return;
      }
      // Гонка: два параллельных запроса на создание учётки одному
      // пользователю (два чата / два устройства).
      res.status(409).json({ error: "credential_exists" });
      return;
    }
    console.error("[UserCredential] createUserCredential failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /internal/bot/user-credentials/lookup — «Мой логин».
 *
 * Пароль НЕ возвращается: в БД только хэш. Забывшему пароль — сброс через
 * /auth/forgot-password.
 */
export const lookupUserCredential = async (req: Request, res: Response): Promise<void> => {
  const telegramId = parseTelegramId(req.body?.telegramId);
  if (telegramId === null) {
    res.status(400).json({ error: "telegramId is required and must be numeric" });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { telegramId },
      select: { credential: { select: { login: true, mustChangePassword: true } } },
    });

    if (!user?.credential) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    res.json({
      login: user.credential.login,
      mustChangePassword: user.credential.mustChangePassword,
    });
  } catch (error) {
    console.error("[UserCredential] lookupUserCredential failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
