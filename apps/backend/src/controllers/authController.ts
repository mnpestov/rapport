import crypto from "crypto";
import { Request, Response } from "express";
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

  console.log(`[AUTH] [${requestId}] Request started`);

  const { initData } = req.body;
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
    subResult = { isSubscriber: true, gatewayStatusCode: null, gatewayResponse: null, errorName: null, gatewayDurationMs: null };
    console.log(`[AUTH] [${requestId}] Telegram validation OK (dev mock)`);
    console.log(`[AUTH] [${requestId}] telegramId=${telegramId} username=${username} firstName=${firstName} lastName=${lastName}`);
  } else {
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error(`[AUTH] [${requestId}] BOT_TOKEN is not configured.`);
      return res.status(500).json({ error: "Server configuration error" });
    }

    const { isValid, user } = validateTelegramWebAppData(initData, botToken);
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
    const userRecord = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: { firstName, lastName, username, languageCode },
      create: { telegramId: BigInt(telegramId), firstName, lastName, username, languageCode },
    });

    console.log(`[AUTH] [${requestId}] User upsert completed dbUserId=${userRecord.id}`);

    // ── Whitelist ─────────────────────────────────────────────────────────────
    const whitelistResult = await checkWhitelistAccess({ telegramId, subResult });
    const { effectiveIsSubscriber, whitelistEntry, finalDecision, shouldWriteWhitelistLog, shouldWriteDebugLog } = whitelistResult;

    console.log(`[AUTH] [${requestId}] Final decision: ${finalDecision}`);

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
      },
    };

    console.log(`[AUTH] [${requestId}] Response isSubscriber=${effectiveIsSubscriber} authDurationMs=${authDurationMs}`);
    console.dir(responseBody, { depth: null });

    res.json(responseBody);

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
