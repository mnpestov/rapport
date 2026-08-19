import { Request, Response } from "express";
import { prisma } from "../prismaClient";

// POST /analytics/paywall-impression — marks "shown now" for the 7-day gate
// (PAYWALL_BANNER_PLAN.md §4/§5.2). Called once when the banner renders, and
// again with { clicked: true } if the user taps the CTA — the CTA is a
// stub (PAYWALL_BANNER_PLAN.md §7), so the click itself is the only signal
// of interest available before Robokassa is wired up. Idempotent: a retry
// just moves the timestamp to "now" again, no separate protection needed.
export const submitPaywallImpression = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const clicked = req.body?.clicked === true;

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        lastPaywallShownAt: new Date(),
        ...(clicked ? { lastPaywallClickedAt: new Date() } : {}),
      },
    });
    res.status(204).end();
  } catch (error) {
    console.error("[Paywall] Failed to record impression:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
