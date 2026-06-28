export type DiagnosticOutcome =
  | 'SUBSCRIBED'
  | 'NOT_SUBSCRIBED'
  | 'KICKED'
  | 'PARTICIPANT_ID_INVALID'
  | 'AUTO_FIXED'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'GATEWAY_ERROR';

export interface DiagnoseRequest {
  telegramId: number;
  mode: 'diagnose' | 'diagnose-and-fix';
  username?: string;
  firstName?: string;
  lastName?: string;
  traceId?: string;
}

export interface DiagnosticResponse {
  diagnosticCode: DiagnosticOutcome;
  meta: {
    requestId: string;
    diagnosticTimestamp: string;
  };
  telegram: {
    status: string | null;
    isParticipantIdInvalid: boolean;
    gatewayStatusCode: number | string | null;
    gatewayDurationMs: number | null;
  };
  whitelist: {
    existedBefore: boolean;
    forceAllow: boolean | null;
    needsInvestigation: boolean | null;
    actionTaken: 'none' | 'whitelist_created' | 'whitelist_updated';
  };
  access: {
    effectiveIsSubscriber: boolean;
  };
}
