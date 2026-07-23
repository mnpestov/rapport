import { Request, Response } from "express";
import { AnalyticsService } from "../services/analyticsService";

/**
 * Analytics HTTP layer. userId comes from the JWT (req.user), never the body.
 * Persistence is delegated to AnalyticsService. API shape is unchanged.
 */

// POST /analytics/pattern-view
export const recordPatternView = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.body ?? {};
  if (typeof patternId !== "string" || patternId.length === 0) {
    res.status(400).json({ error: "patternId is required" });
    return;
  }

  try {
    await AnalyticsService.recordPatternView(userId, patternId);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Analytics] recordPatternView failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /analytics/pattern-link-click
export const recordPatternLinkClick = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { patternId } = req.body ?? {};
  if (typeof patternId !== "string" || patternId.length === 0) {
    res.status(400).json({ error: "patternId is required" });
    return;
  }

  try {
    await AnalyticsService.recordPatternLinkClick(userId, patternId);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Analytics] recordPatternLinkClick failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /analytics/subscribe-click
export const recordSubscribeClick = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;

  try {
    await AnalyticsService.recordSubscribeClick(userId);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Analytics] recordSubscribeClick failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /analytics/search-query
export const recordSearchQuery = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  const { query, resultsCount } = req.body ?? {};
  if (typeof query !== "string" || query.trim().length < 2) {
    res.status(400).json({ error: "query must be a string with at least 2 characters" });
    return;
  }
  if (typeof resultsCount !== "number" || !Number.isInteger(resultsCount) || resultsCount < 0) {
    res.status(400).json({ error: "resultsCount is required" });
    return;
  }

  try {
    await AnalyticsService.recordSearchQuery(userId, query, resultsCount);
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("[Analytics] recordSearchQuery failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
