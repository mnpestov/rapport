import crypto from "crypto";
import { Request, Response } from "express";
import { validateTelegramWebAppData } from "../utils/telegramAuth";
import { generateToken } from "../utils/jwt";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionDetailed, SubscriptionCheckResult } from "../utils/checkSubscription";
import { checkWhitelistAccess } from "../services/whitelistService";
import { buildPaywallState } from "../services/authSession";
import { logWhitelistCheck, logAuthDebug } from "../utils/whitelistLogger";

// Пошаговый трейсинг — оставлен от расследования конкретного инцидента с
// авторизацией, но не нужен в постоянной работе и не должен литься
// безусловно в prod-логи. Включается явно, никогда не по умолчанию.
const AUTH_DEBUG_LOGGING = process.env.AUTH_DEBUG_LOGGING === "true";
const debugLog = (...args: unknown[]) => {
  if (AUTH_DEBUG_LOGGING) console.log(...args);
};

export const telegramAuth = async (req: Request, res: Response) => {
  // ── Preamble ───────────────────────────────────────────────────────────────
  const requestId = crypto.randomUUID();
  // gatewayRequestId matches requestId now; will diverge when gateway returns its own ID via response header
  const gatewayRequestId = requestId;
  const authStart = Date.now();

  debugLog(`[AUTH] [${requestId}] Step 1: Request started`);
  debugLog(`[AUTH] [${requestId}] Step 1: content-type=${req.headers["content-type"] ?? "(none)"} method=${req.method} url=${req.url}`);

  debugLog(`[AUTH] [${requestId}] Step 2: req.body available`);
  debugLog(`[AUTH] [${requestId}] Step 2: typeof req.body=${typeof req.body} req.body===undefined=${req.body === undefined}`);
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
    debugLog(`[AUTH] [${requestId}] Step 2: Object.keys(req.body)=${JSON.stringify(Object.keys(req.body))}`);
  }

  let initData: string | undefined;
  try {
    debugLog(`[AUTH] [${requestId}] Step 3: initData extracted`);
    initData = req.body?.initData;
  } catch (bodyErr) {
    console.error(`[AUTH] [${requestId}] Step 3: EXCEPTION accessing req.body.initData`, bodyErr);
    throw bodyErr;
  }

  debugLog(`[AUTH] [${requestId}] Step 4: initData length=${initData != null ? String(initData).length : "n/a"} type=${typeof initData}`);

  if (!initData) {
    return res.status(400).json({ error: "initData is required" });
  }

  const initDataLength = String(initData).length;
  debugLog(`[AUTH] [${requestId}] initData received, length=${initDataLength}`);

  const allowDevAuth = process.env.ALLOW_DEV_AUTH === "true";

  let telegramId: number;
  let firstName: string;
  let lastName: string | undefined;
  let username: string | undefined;
  let languageCode: string | undefined;
  let authDate: number | null = null;
  let subResult: SubscriptionCheckResult;

  // ── Telegram validation ────────────────────────────────────────────────────
  if (initData === "mock_dev" && allowDevAuth) {
    telegramId = 123456789;
    firstName = "Dev";
    lastName = "User";
    username = "devuser";
    languageCode = "ru";
    subResult = { isSubscriber: true, gatewayStatusCode: null, gatewayResponse: null, errorName: null, gatewayDurationMs: null, isParticipantIdInvalid: false };
    debugLog(`[AUTH] [${requestId}] Telegram validation OK (dev mock)`);
    debugLog(`[AUTH] [${requestId}] telegramId=${telegramId} username=${username} firstName=${firstName} lastName=${lastName}`);
  } else {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error(`[AUTH] [${requestId}] BOT_TOKEN is not configured.`);
      return res.status(500).json({ error: "Server configuration error" });
    }

    debugLog(`[AUTH] [${requestId}] Step 5: validateTelegramWebAppData() start`);
    const { isValid, user } = validateTelegramWebAppData(initData, botToken);
    debugLog(`[AUTH] [${requestId}] Step 6: validateTelegramWebAppData() done isValid=${isValid} hasUser=${!!user}`);
    if (!isValid || !user) {
      console.error(`[AUTH] [${requestId}] Telegram validation FAILED`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    debugLog(`[AUTH] [${requestId}] Telegram validation OK`);

    telegramId = user.id;
    firstName = user.first_name;
    lastName = user.last_name;
    username = user.username;
    languageCode = user.language_code;

    try {
      const raw = new URLSearchParams(initData).get('auth_date');
      if (raw) authDate = parseInt(raw, 10);
    } catch {}

    debugLog(`[AUTH] [${requestId}] telegramId=${telegramId} username=${username ?? null} firstName=${firstName} lastName=${lastName ?? null} authDate=${authDate}`);

    // ── Subscription check ──────────────────────────────────────────────────
    debugLog(`[AUTH] [${requestId}] Checking subscription telegramId=${telegramId}`);

    subResult = await checkTelegramSubscriptionDetailed(telegramId, gatewayRequestId);

    debugLog(`[AUTH] [${requestId}] Subscription result isSubscriber=${subResult.isSubscriber} gatewayDurationMs=${subResult.gatewayDurationMs}`);
  }

  try {
    // ── Database ──────────────────────────────────────────────────────────────
    // Раньше здесь дополнительно проверялось, существует ли пользователь —
    // это было нужно только временному auto-grant PREMIUM_CORE (убран при
    // публичном запуске, см. ниже), чтобы он срабатывал ровно один раз, на
    // создании аккаунта. Вместе с грантом убран и лишний запрос: он
    // выполнялся на каждой авторизации, а результат больше никто не читает.
    const userRecord = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { firstName, lastName, username, languageCode },
      create: { telegramId: BigInt(telegramId), firstName, lastName, username, languageCode },
      include: { permissions: { select: { permission: true } } },
    });

    debugLog(`[AUTH] [${requestId}] User upsert completed dbUserId=${userRecord.id}`);

    // Здесь до публичного запуска платной подписки стоял временный
    // auto-grant PREMIUM_CORE каждому новому пользователю — чтобы на этапе
    // подготовки для людей ничего не менялось. Убран в день запуска вместе
    // с парной строкой `permissions.push(PREMIUM_CORE)` ниже: снимать
    // только одно из двух нельзя, иначе ответ авторизации продолжал бы
    // сообщать новому пользователю о разрешении, которого в БД уже никто не
    // выдаёт (PAID_TIER_PERMISSIONS_PLAN.md §8). С этого момента
    // PREMIUM_CORE выдаётся исключительно по факту оплаты
    // (services/paymentCompletion.ts).

    const permissions = userRecord.permissions.map((p) => p.permission as string);

    // ── Whitelist ─────────────────────────────────────────────────────────────
    const whitelistResult = await checkWhitelistAccess({ telegramId, username, firstName, lastName, subResult });
    const { effectiveIsSubscriber, whitelistEntry, finalDecision, shouldWriteWhitelistLog, shouldWriteDebugLog } = whitelistResult;

    debugLog(`[AUTH] [${requestId}] Final decision: ${finalDecision}`);

    // ── Paywall / предупреждения об истечении ────────────────────────────────
    // Логика целиком в services/authSession.ts (buildPaywallState) — она
    // одинакова для Mini App и веб-входа, см. BROWSER_ACCESS_PLAN.md §4.3.
    // Перенесена дословно, поведение не менялось.
    const { showPaywallBanner, subscriptionWarning, paywallUiEnabled } = buildPaywallState({
      user: userRecord,
      permissions,
      effectiveIsSubscriber,
      allowDevAuth,
    });

    // ── JWT ───────────────────────────────────────────────────────────────────
    const token = generateToken({
      userId: userRecord.id,
      telegramId: telegramId.toString(),
    });

    debugLog(`[AUTH] [${requestId}] JWT generated`);

    const authDurationMs = Date.now() - authStart;
    const ip = req.ip ?? req.socket?.remoteAddress ?? null;

    // ── Logging ───────────────────────────────────────────────────────────────
    if (shouldWriteWhitelistLog && whitelistEntry) {
      logWhitelistCheck({
        timestamp: new Date().toISOString(),
        requestId,
        event: 'whitelist_check',
        telegramId: telegramId.toString(),
        username: username ?? null,
        ip,
        subscriptionResult: subResult.isSubscriber,
        forceAllow: whitelistEntry.forceAllow,
        debugLogging: whitelistEntry.debugLogging,
        finalDecision,
      });
    }

    if (shouldWriteDebugLog && whitelistEntry) {
      logAuthDebug({
        timestamp: new Date().toISOString(),
        requestId,
        gatewayRequestId,
        event: 'auth_debug',
        telegramId: telegramId.toString(),
        username: username ?? null,
        firstName,
        lastName: lastName ?? null,
        initDataLength,
        authDate,
        ip,
        userAgent: req.headers['user-agent'] ?? null,
        telegramValidation: 'ok',
        subscription: {
          isSubscriber: subResult.isSubscriber,
          gatewayStatusCode: subResult.gatewayStatusCode,
          gatewayResponse: subResult.gatewayResponse,
          errorName: subResult.errorName,
          gatewayDurationMs: subResult.gatewayDurationMs,
        },
        whitelist: {
          match: true,
          record: {
            id: whitelistEntry.id,
            username: whitelistEntry.username ?? null,
            firstName: whitelistEntry.firstName ?? null,
            lastName: whitelistEntry.lastName ?? null,
            comment: whitelistEntry.comment ?? null,
            forceAllow: whitelistEntry.forceAllow,
            debugLogging: whitelistEntry.debugLogging,
            createdAt: whitelistEntry.createdAt.toISOString(),
            createdBy: whitelistEntry.createdBy ?? null,
          },
        },
        dbUserId: userRecord.id,
        finalDecision,
        responseIsSubscriber: effectiveIsSubscriber,
        authDurationMs,
      });
    }

    // ── Response ───────────────────────────────────────────────────────────────
    const responseBody = {
      isSubscriber: effectiveIsSubscriber,
      token,
      user: {
        id: userRecord.id,
        telegramId: telegramId.toString(),
        firstName: userRecord.firstName,
        // NOT a JWT claim — see resolveRole.ts / PAID_TIER_ROLLOUT_PLAN.md
        // §2.3 for why role-gated reads always re-check the DB instead.
        // This is only how the frontend knows whether to render the
        // premium-only UI (author link etc.) it already got real data for.
        role: userRecord.role,
        // Same non-boundary caveat as role — see usePremiumAccess.ts.
        permissions,
        showPaywallBanner,
        subscriptionWarning,
        // Показывать ли кнопку подписки в строке поиска. До публичного
        // запуска — только админу (см. paywallUiEnabled выше).
        paywallUiEnabled,
        // Нужна кнопке подписки в строке поиска: у действующего подписчика
        // она открывает шторку "Premium-доступ активен до <дата>".
        premiumExpiresAt: userRecord.premiumExpiresAt?.toISOString() ?? null,
      },
    };

    // Не логировать responseBody целиком — оно содержит выданный JWT (token).
    debugLog(`[AUTH] [${requestId}] Response isSubscriber=${effectiveIsSubscriber} authDurationMs=${authDurationMs}`);

    res.json(responseBody);

    // lastSeenAt tracks any successful authenticated visit, not just
    // subscriber visits — the dashboard's "visitors in period" stat filters
    // on this field and must not undercount non-subscribers who still use
    // the app (see admin/dashboard/stats totalUsers via lastSeenAt).
    void prisma.user.update({
      where: { id: userRecord.id },
      data: { lastSeenAt: new Date() },
    }).catch((err) => {
      console.error(`[AUTH] [${requestId}] Failed to update lastSeenAt:`, err);
    });

    if (finalDecision === 'authorized_via_whitelist' && whitelistEntry) {
      void prisma.whitelistedUser.update({
        where: { id: whitelistEntry.id },
        data: {
          needsInvestigation: true,
          lastWhitelistAuthorizationAt: new Date(),
        },
      }).catch((err) => {
        console.error(`[AUTH] [${requestId}] Failed to update whitelist investigation fields:`, err);
      });
    }
  } catch (error) {
    console.error(`[AUTH] [${requestId}] Unexpected error`);
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
