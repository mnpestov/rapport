import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '../../logs');
fs.mkdirSync(logsDir, { recursive: true });

const AUTH_DEBUG_LOG = path.join(logsDir, 'auth-debug.log');
const WHITELIST_LOG = path.join(logsDir, 'whitelist.log');

function write(filePath: string, entry: object): void {
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.error(`[Logger] Failed to write to ${filePath}:`, err);
  }
}

// ---------------------------------------------------------------------------
// whitelist.log
// One entry per auth request for every user found in the whitelist,
// regardless of whether their subscription check succeeded or not.
// ---------------------------------------------------------------------------
export interface WhitelistCheckEntry {
  timestamp: string;
  requestId: string;
  event: 'whitelist_check';
  telegramId: string;
  username: string | null;
  ip: string | null;
  subscriptionResult: boolean;
  forceAllow: boolean;
  debugLogging: boolean;
  finalDecision: 'authorized_via_subscription' | 'authorized_via_whitelist' | 'denied';
}

export function logWhitelistCheck(entry: WhitelistCheckEntry): void {
  write(WHITELIST_LOG, entry);
}

// ---------------------------------------------------------------------------
// auth-debug.log
// Full auth process per request, written only when the whitelist record
// has debugLogging=true — regardless of subscription outcome.
// ---------------------------------------------------------------------------
export interface AuthDebugEntry {
  timestamp: string;
  requestId: string;
  gatewayRequestId: string;
  event: 'auth_debug';
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  initDataLength: number;
  authDate: number | null;
  ip: string | null;
  userAgent: string | null;
  telegramValidation: 'ok';
  subscription: {
    isSubscriber: boolean;
    gatewayStatusCode: number | string | null;
    gatewayResponse: unknown;
    errorName: string | null;
    gatewayDurationMs: number | null;
  };
  whitelist: {
    match: true;
    record: {
      id: string;
      username: string | null;
      firstName: string | null;
      lastName: string | null;
      comment: string | null;
      forceAllow: boolean;
      debugLogging: boolean;
      createdAt: string;
      createdBy: string | null;
    };
  };
  dbUserId: string;
  finalDecision: 'authorized_via_subscription' | 'authorized_via_whitelist' | 'denied';
  responseIsSubscriber: boolean;
  authDurationMs: number;
}

export function logAuthDebug(entry: AuthDebugEntry): void {
  write(AUTH_DEBUG_LOG, entry);
}
