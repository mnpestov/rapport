import { WhitelistedUser } from '@prisma/client';
import { prisma } from '../prismaClient';
import { SubscriptionCheckResult } from '../utils/checkSubscription';

export interface CheckWhitelistAccessParams {
  telegramId: number;
  subResult: SubscriptionCheckResult;
}

export interface CheckWhitelistAccessResult {
  effectiveIsSubscriber: boolean;
  whitelistEntry: WhitelistedUser | null;
  finalDecision: 'authorized_via_subscription' | 'authorized_via_whitelist' | 'denied';
  shouldWriteWhitelistLog: boolean;
  shouldWriteDebugLog: boolean;
}

export async function checkWhitelistAccess(
  params: CheckWhitelistAccessParams
): Promise<CheckWhitelistAccessResult> {
  const { telegramId, subResult } = params;

  const whitelistEntry = await prisma.whitelistedUser.findUnique({
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
