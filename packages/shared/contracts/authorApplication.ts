// Shared between backend, support-bot, mini app, and admin
// (implementation_plan.md §4, §6, §7, §8).

export type ApplicationStatus = 'PENDING' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED';

// status is null when the user has never applied — not an error, just
// "show the start-a-dialog screen" (see bot POST /internal/bot/author-application/status).
// adminComment/processedAt are absent (not null) on the { status: null } branch —
// optional here rather than nullable to match that shape exactly.
export interface AuthorApplicationStatusResponse {
  status: ApplicationStatus | null;
  adminComment?: string | null;
  processedAt?: string | null;
}
