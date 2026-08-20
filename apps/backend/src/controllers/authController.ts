import crypto from "crypto";
import { Request, Response } from "express";
import { Permission, UserRole } from "@prisma/client";
import { validateTelegramWebAppData } from "../utils/telegramAuth";
import { generateToken } from "../utils/jwt";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionDetailed, SubscriptionCheckResult } from "../utils/checkSubscription";
import { checkWhitelistAccess } from "../services/whitelistService";
import { logWhitelistCheck, logAuthDebug } from "../utils/whitelistLogger";

export const telegramAuth = async (req: Request, res: Response) => {
  // ── Preamble ───────────────────────────────────────────────────────────────
  const requestId = crypto.randomUUID();
  // gatewayRequestId matches requestId now; will diverge when gateway returns its own ID via response header
  const gatewayRequestId = requestId;
  const authStart = Date.now();

  console.log(`[AUTH] [${requestId}] Step 1: Request started`);
  console.log(`[AUTH] [${requestId}] Step 1: content-type=${req.headers["content-type"] ?? "(none)"} method=${req.method} url=${req.url}`);

  console.log(`[AUTH] [${requestId}] Step 2: req.body available`);
  console.log(`[AUTH] [${requestId}] Step 2: typeof req.body=${typeof req.body} req.body===undefined=${req.body === undefined}`);
  if (req.body !== undefined && req.body !== null && typeof req.body === "object") {
    console.log(`[AUTH] [${requestId}] Step 2: Object.keys(req.body)=${JSON.stringify(Object.keys(req.body))}`);
  }

  let initData: string | undefined;
  try {
    console.log(`[AUTH] [${requestId}] Step 3: initData extracted`);
    initData = req.body?.initData;
  } catch (bodyErr) {
    console.error(`[AUTH] [${requestId}] Step 3: EXCEPTION accessing req.body.initData`, bodyErr);
    throw bodyErr;
  }

  console.log(`[AUTH] [${requestId}] Step 4: initData length=${initData != null ? String(initData).length : "n/a"} type=${typeof initData}`);

  if (!initData) {
    return res.status(400).json({ error: "initData is required" });
  }

  const initDataLength = String(initData).length;
  console.log(`[AUTH] [${requestId}] initData received, length=${initDataLength}`);

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
    console.log(`[AUTH] [${requestId}] Telegram validation OK (dev mock)`);
    console.log(`[AUTH] [${requestId}] telegramId=${telegramId} username=${username} firstName=${firstName} lastName=${lastName}`);
  } else {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error(`[AUTH] [${requestId}] BOT_TOKEN is not configured.`);
      return res.status(500).json({ error: "Server configuration error" });
    }

    console.log(`[AUTH] [${requestId}] Step 5: validateTelegramWebAppData() start`);
    const { isValid, user } = validateTelegramWebAppData(initData, botToken);
    console.log(`[AUTH] [${requestId}] Step 6: validateTelegramWebAppData() done isValid=${isValid} hasUser=${!!user}`);
    if (!isValid || !user) {
      console.error(`[AUTH] [${requestId}] Telegram validation FAILED`);
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`[AUTH] [${requestId}] Telegram validation OK`);

    telegramId = user.id;
    firstName = user.first_name;
    lastName = user.last_name;
    username = user.username;
    languageCode = user.language_code;

    try {
      const raw = new URLSearchParams(initData).get('auth_date');
      if (raw) authDate = parseInt(raw, 10);
    } catch {}

    console.log(`[AUTH] [${requestId}] telegramId=${telegramId} username=${username ?? null} firstName=${firstName} lastName=${lastName ?? null} authDate=${authDate}`);

    // ── Subscription check ──────────────────────────────────────────────────
    console.log(`[AUTH] [${requestId}] Checking subscription telegramId=${telegramId}`);

    subResult = await checkTelegramSubscriptionDetailed(telegramId, gatewayRequestId);

    console.log(`[AUTH] [${requestId}] Subscription result isSubscriber=${subResult.isSubscriber} gatewayDurationMs=${subResult.gatewayDurationMs}`);
  }

  try {
    // ── Database ──────────────────────────────────────────────────────────────
    // upsert() doesn't report create-vs-update, and this whole handler runs
    // on every login, not just the first — checking existence first is what
    // lets the auto-grant below run exactly once, on real account creation,
    // instead of re-firing (and silently undoing an admin's revocation) on
    // every subsequent open of the mini app. See PAID_TIER_PERMISSIONS_PLAN.md §5.
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      select: { id: true },
    });

    const userRecord = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { firstName, lastName, username, languageCode },
      create: { telegramId: BigInt(telegramId), firstName, lastName, username, languageCode },
      include: { permissions: { select: { permission: true } } },
    });

    console.log(`[AUTH] [${requestId}] User upsert completed dbUserId=${userRecord.id}`);

    // TEMPORARY: pre-payment period only — PREMIUM_CORE (density/yarn-
    // thickness filters, already free in prod before the permissions system
    // existed) is auto-granted to every newly created user so nothing changes
    // for them. Gated on `!existingUser`, not the upsert branch, for exactly
    // the reason above. Removing this is part of the "launch day" runbook —
    // together with the `permissions.push` below, not on its own (removing
    // one without the other leaves the auth response lying about what a new
    // user actually has). See PAID_TIER_PERMISSIONS_PLAN.md §8.
    if (!existingUser) {
      await prisma.userPermission.upsert({
        where: { userId_permission: { userId: userRecord.id, permission: Permission.PREMIUM_CORE } },
        create: { userId: userRecord.id, permission: Permission.PREMIUM_CORE },
        update: {},
      });
    }

    // userRecord.permissions reflects DB state as of the upsert above, i.e.
    // BEFORE the grant just issued for a brand new user — append it manually
    // rather than re-querying (see PAID_TIER_PERMISSIONS_PLAN.md §3.4).
    const permissions = userRecord.permissions.map((p) => p.permission as string);
    if (!existingUser) {
      permissions.push(Permission.PREMIUM_CORE);
    }

    // ── Whitelist ─────────────────────────────────────────────────────────────
    const whitelistResult = await checkWhitelistAccess({ telegramId, username, firstName, lastName, subResult });
    const { effectiveIsSubscriber, whitelistEntry, finalDecision, shouldWriteWhitelistLog, shouldWriteDebugLog } = whitelistResult;

    console.log(`[AUTH] [${requestId}] Final decision: ${finalDecision}`);

    // ── Paywall banner gate ──────────────────────────────────────────────────
    // See PAYWALL_BANNER_PLAN.md §4/§5.1 — never shown to anyone with the
    // paid tier (PREMIUM_EXTRA), and at most once every 7 days.
    // Gated on effectiveIsSubscriber too: the frontend never reaches the
    // catalog/modal render for anyone who fails the channel-subscription
    // gate, so there's no point computing this for them.
    const isAdmin = userRecord.role === UserRole.ADMIN;
    const hasExtra = isAdmin || permissions.includes(Permission.PREMIUM_EXTRA);
    // Kill-switch (PAYMENTS_ROBOKASSA_PLAN.md §7 шаг 5/7a): until public
    // launch, only admins can see the banner at all — this is what lets the
    // real Robokassa payment flow be tested end-to-end on prod (шаг 8)
    // without exposing anything to regular users, who all already have
    // PREMIUM_CORE today and would otherwise see the banner the moment this
    // ships. `isAdmin ||` on the !hasExtra check below is a deliberate
    // bypass just for this: isAdmin already forces hasExtra=true elsewhere
    // (role-gated premium UI), which would otherwise make the banner
    // unreachable even for an admin, i.e. for the very account meant to
    // test it.
    const paywallPubliclyLaunched = process.env.PAYWALL_BANNER_PUBLIC_LAUNCH === "true";
    // Единственный выключатель на ВСЕ платные элементы интерфейса: баннер,
    // предупреждения об истечении и кнопку подписки в строке поиска. Пока
    // флаг выключен, обычный пользователь не видит ничего из этого и
    // работает ровно как раньше; админ видит всё — это и позволяет
    // тестировать на проде до публичного запуска. Держать проверку одну на
    // все три поверхности принципиально: разъехавшись, они дали бы
    // состояние вроде "кнопка есть, а оплатить по ней нельзя".
    const paywallUiEnabled = paywallPubliclyLaunched || isAdmin;
    const showPaywallBanner =
      paywallUiEnabled &&
      effectiveIsSubscriber &&
      (isAdmin || !hasExtra) &&
      // allowDevAuth (ALLOW_DEV_AUTH=true, local-only — see the mock_dev
      // branch above) skips the 7-day cooldown entirely, so the banner is
      // visible on every login while iterating on it. `isAdmin ||` extends
      // the same bypass to prod — otherwise the one open-modal impression
      // (paywallController.ts sets lastPaywallShownAt on it) locks the
      // banner out for the next 7 days even for the account meant to
      // repeatedly test the payment flow on prod (шаг 6/8). Never true for
      // a non-admin in prod, where the real cooldown always applies.
      (allowDevAuth ||
        isAdmin ||
        userRecord.lastPaywallShownAt === null ||
        Date.now() - userRecord.lastPaywallShownAt.getTime() >= 7 * 24 * 60 * 60 * 1000);

    // ── Предупреждение об истечении подписки ─────────────────────────────────
    // Считается на бэкенде по той же причине, что и showPaywallBanner: фронт
    // получает готовое решение, а не сырую дату, которую пришлось бы
    // интерпретировать в двух местах. Не пересекается с баннером — тот
    // показывается только тем, у кого доступа НЕТ, а это, наоборот, только
    // действующим подписчикам. Пороги совпадают с cron-напоминанием в бот
    // (checkSubscriptions.ts, 3 дня), плюс отдельный "последний день".
    let subscriptionWarning: "expiring_3_days" | "expiring_1_day" | null = null;
    if (paywallUiEnabled && effectiveIsSubscriber && userRecord.premiumExpiresAt) {
      const msLeft = userRecord.premiumExpiresAt.getTime() - Date.now();
      if (msLeft > 0) {
        const daysLeft = msLeft / (24 * 60 * 60 * 1000);
        if (daysLeft <= 1) subscriptionWarning = "expiring_1_day";
        else if (daysLeft <= 3) subscriptionWarning = "expiring_3_days";
      }
    }

    // ── JWT ───────────────────────────────────────────────────────────────────
    const token = generateToken({
      userId: userRecord.id,
      telegramId: telegramId.toString(),
    });

    console.log(`[AUTH] [${requestId}] JWT generated`);

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

    console.log(`[AUTH] [${requestId}] Response isSubscriber=${effectiveIsSubscriber} authDurationMs=${authDurationMs}`);
    console.dir(responseBody, { depth: null });

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
