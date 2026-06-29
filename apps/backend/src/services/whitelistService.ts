import { WhitelistedUser } from '@prisma/client';
import { prisma } from '../prismaClient';
import { SubscriptionCheckResult } from '../utils/checkSubscription';

export interface CheckWhitelistAccessParams {
  telegramId: number;
  username: string | undefined;
  firstName: string;
  lastName: string | undefined;
  subResult: SubscriptionCheckResult;
}

export interface CheckWhitelistAccessResult {
  effectiveIsSubscriber: boolean;
  whitelistEntry: WhitelistedUser | null;
  finalDecision: 'authorized_via_subscription' | 'authorized_via_whitelist' | 'denied';
  shouldWriteWhitelistLog: boolean;
  shouldWriteDebugLog: boolean;
}

export async function ensureParticipantIdInvalidQuarantine(params: {
  telegramId: number;
  username: string | undefined;
  firstName: string;
  lastName: string | undefined;
}): Promise<WhitelistedUser> {
  const { telegramId, username, firstName, lastName } = params;
  const now = new Date();

  return prisma.whitelistedUser.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: {
      telegramId: BigInt(telegramId),
      username: username ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      forceAllow: true,
      debugLogging: true,
      needsInvestigation: true,
      lastWhitelistAuthorizationAt: now,
      comment: `AUTO: PARTICIPANT_ID_INVALID ${now.toISOString()}`,
    },
    update: {
      needsInvestigation: true,
      lastWhitelistAuthorizationAt: now,
    },
  });
}

export async function ensureContactedViaBotWhitelist(params: {
  telegramId: number;
  username: string | undefined;
  firstName: string;
  lastName: string | undefined;
}): Promise<WhitelistedUser> {
  const { telegramId, username, firstName, lastName } = params;
  const now = new Date();

  return prisma.whitelistedUser.upsert({
    where: { telegramId: BigInt(telegramId) },
    create: {
      telegramId: BigInt(telegramId),
      username: username ?? null,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      forceAllow: true,
      debugLogging: true,
      contactedViaBot: true,
      comment: `BOT: Обратился через бота поддержки ${now.toISOString()}`,
    },
    update: {
      contactedViaBot: true,
      username: username ?? undefined,
      firstName: firstName || undefined,
      lastName: lastName ?? undefined,
    },
  });
}

export async function checkWhitelistAccess(
  params: CheckWhitelistAccessParams
): Promise<CheckWhitelistAccessResult> {
  const { telegramId, username, firstName, lastName, subResult } = params;

  let whitelistEntry = await prisma.whitelistedUser.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });

  if (!whitelistEntry) {
    const finalDecision = subResult.isSubscriber ? 'authorized_via_subscription' : 'denied';
    return {
      effectiveIsSubscriber: subResult.isSubscriber,
      whitelistEntry: null,
      finalDecision,
      shouldWriteWhitelistLog: false,
      shouldWriteDebugLog: false,
    };
  }

  const effectiveIsSubscriber = subResult.isSubscriber || whitelistEntry.forceAllow;

  const finalDecision: 'authorized_via_subscription' | 'authorized_via_whitelist' | 'denied' =
    subResult.isSubscriber
      ? 'authorized_via_subscription'
      : whitelistEntry.forceAllow
      ? 'authorized_via_whitelist'
      : 'denied';

  return {
    effectiveIsSubscriber,
    whitelistEntry,
    finalDecision,
    shouldWriteWhitelistLog: true,
    shouldWriteDebugLog: whitelistEntry.debugLogging,
  };
}
