import crypto from 'crypto';
import type { DiagnosticResponse, DiagnosticOutcome } from '@knitting/shared';
import { checkTelegramSubscriptionDetailed, SubscriptionCheckResult } from '../utils/checkSubscription';
import { ensureParticipantIdInvalidQuarantine } from './whitelistService';
import { prisma } from '../prismaClient';

export interface RunDiagnosticParams {
  telegramId: number;
  mode: 'diagnose' | 'diagnose-and-fix';
  username?: string;
  firstName?: string;
  lastName?: string;
}

function isGatewayError(subResult: SubscriptionCheckResult): boolean {
  if (subResult.errorName) return true;
  const sc = subResult.gatewayStatusCode;
  if (sc === 'TIMEOUT' || sc === 'ERROR') return true;
  if (typeof sc === 'number' && sc >= 500) return true;
  return false;
}

function extractTelegramMemberStatus(gatewayResponse: unknown): string | null {
  if (gatewayResponse === null || typeof gatewayResponse !== 'object') return null;
  const resp = gatewayResponse as Record<string, unknown>;
  if (typeof resp['telegramResponse'] !== 'object' || resp['telegramResponse'] === null) return null;
  const tr = resp['telegramResponse'] as Record<string, unknown>;
  return typeof tr['status'] === 'string' ? tr['status'] : null;
}

export async function runDiagnostic(params: RunDiagnosticParams): Promise<DiagnosticResponse> {
  const { telegramId, mode, username, firstName, lastName } = params;
  const requestId = crypto.randomUUID();
  const diagnosticTimestamp = new Date().toISOString();

  const subResult = await checkTelegramSubscriptionDetailed(telegramId, requestId);
  const telegramStatus = extractTelegramMemberStatus(subResult.gatewayResponse);

  const existingEntry = await prisma.whitelistedUser.findUnique({
    where: { telegramId: BigInt(telegramId) },
  });
  const existedBefore = existingEntry !== null;

  let diagnosticCode: DiagnosticOutcome;
  let actionTaken: 'none' | 'whitelist_created' | 'whitelist_updated' = 'none';
  let effectiveIsSubscriber = subResult.isSubscriber;
  let finalEntry = existingEntry;

  if (isGatewayError(subResult)) {
    diagnosticCode = 'GATEWAY_ERROR';
  } else if (subResult.isSubscriber) {
    diagnosticCode = 'SUBSCRIBED';
  } else if (subResult.isParticipantIdInvalid) {
    if (mode === 'diagnose-and-fix') {
      try {
        finalEntry = await ensureParticipantIdInvalidQuarantine({
          telegramId,
          username,
          firstName: firstName ?? '',
          lastName,
        });
        actionTaken = existedBefore ? 'whitelist_updated' : 'whitelist_created';
        effectiveIsSubscriber = true;
        diagnosticCode = 'AUTO_FIXED';
      } catch (err) {
        console.error('[DiagnosticService] ensureParticipantIdInvalidQuarantine failed:', err);
        diagnosticCode = 'MANUAL_REVIEW_REQUIRED';
      }
    } else {
      diagnosticCode = 'PARTICIPANT_ID_INVALID';
    }
  } else {
    diagnosticCode = telegramStatus === 'kicked' ? 'KICKED' : 'NOT_SUBSCRIBED';
  }

  return {
    diagnosticCode,
    meta: { requestId, diagnosticTimestamp },
    telegram: {
      status: telegramStatus,
      isParticipantIdInvalid: subResult.isParticipantIdInvalid,
      gatewayStatusCode: subResult.gatewayStatusCode,
      gatewayDurationMs: subResult.gatewayDurationMs,
    },
    whitelist: {
      existedBefore,
      forceAllow: finalEntry?.forceAllow ?? null,
      needsInvestigation: finalEntry?.needsInvestigation ?? null,
      actionTaken,
    },
    access: { effectiveIsSubscriber },
  };
}
