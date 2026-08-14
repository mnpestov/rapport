import { Request, Response } from "express";
import { spawn, execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { prisma } from "../prismaClient";

const execFileAsync = promisify(execFile);
const SCRIPTS_DIR = path.resolve(__dirname, "../../src/scripts");

// Rows are written directly by check_price_updates.py (psycopg2, not
// through this app) — this is a read-only view for the admin
// "Справочник" page. Newest first, capped — this table grows by 2
// rows/day (see cron in run_price_check.sh), no pagination needed for a
// long time.
const LIMIT = 60;

export const getPriceCheckRuns = async (_req: Request, res: Response) => {
  try {
    const runs = await prisma.priceCheckRun.findMany({
      orderBy: { startedAt: "desc" },
      take: LIMIT,
    });
    res.json({ data: runs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch price check runs" });
  }
};

// author_sync_lib/confirmed_authors.py is THE single source of truth for
// who this job checks (see its own docstring — generate_prod_backfill_sql.py
// imports the same list) — reading it via a one-off python3 -c instead of
// hand-maintaining a parallel TS copy that could drift. Cheap (no DB, no
// network, sub-100ms) and always exactly in sync with what
// check_price_updates.py itself would use.
const readConfirmedAuthors = async (): Promise<string[]> => {
  const { stdout } = await execFileAsync(
    "python3",
    ["-c", "import json; from author_sync_lib.confirmed_authors import CONFIRMED_AUTHORS; print(json.dumps(CONFIRMED_AUTHORS))"],
    { cwd: SCRIPTS_DIR }
  );
  return JSON.parse(stdout);
};

export const getConfirmedAuthors = async (_req: Request, res: Response) => {
  try {
    res.json({ authors: await readConfirmedAuthors() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to read confirmed authors list" });
  }
};

// Fire-and-forget spawn — a full run takes tens of minutes (~53 min at last
// measurement), far too long for one HTTP request, so this starts it in the
// background and the admin page polls isRunning until a new PriceCheckRun
// row shows up.
//
// "isRunning" is NOT tracked as an in-memory flag on this Node process —
// deliberately. An earlier version did (module-level boolean, same pattern
// as syncController.ts's runSync/getSyncStatus), and it silently desynced
// from reality every time the backend restarted mid-run: under `tsx watch`
// in dev, ANY other backend file being saved respawns this process, wiping
// the flag back to false while the already-spawned bash/python subprocess
// (not in the same process group, unaffected by the restart) kept running
// completely orphaned and invisible — the admin UI showed "not running"
// within seconds and no report ever appeared, even though the real script
// was still working for another 40+ minutes and eventually wrote its
// PriceCheckRun row nobody was watching for anymore. A prod deploy mid-run
// would hit the exact same failure mode, just far more rarely.
// Instead, ask the OS: /tmp/price_check.lock is the same flock
// run_price_check.sh itself holds for its whole duration (see that file) —
// checking whether it's currently acquirable is a live, restart-proof
// source of truth, no separate state to keep in sync.
const LOCK_FILE = "/tmp/price_check.lock";
const isPriceCheckActuallyRunning = (): Promise<boolean> =>
  new Promise((resolve) => {
    execFile("flock", ["-n", LOCK_FILE, "-c", "true"], (error) => {
      // Lock acquired (exit 0) => nothing holds it => not running.
      // Lock busy (non-zero, normally 1) => a run currently holds it.
      resolve(!!error);
    });
  });

export const getPriceCheckStatus = async (_req: Request, res: Response) => {
  res.json({ isRunning: await isPriceCheckActuallyRunning() });
};

export const triggerPriceCheck = async (req: Request, res: Response) => {
  if (await isPriceCheckActuallyRunning()) {
    return res.status(400).json({ error: "Проверка цен уже запущена" });
  }

  // Optional — omitted/empty means "all CONFIRMED_AUTHORS" (check_prices'
  // own default when called with no args). When given, every name must be
  // an actual confirmed author — check_price_updates.py would happily
  // attempt ANY author name passed on argv (it bypasses CONFIRMED_AUTHORS
  // entirely for an explicit list), including ones whose price extraction
  // was never verified to work, so this is the one place enforcing that
  // the admin picker can only ever select from the real list.
  const { authors } = req.body as { authors?: unknown };
  let authorArgs: string[] = [];
  if (Array.isArray(authors) && authors.length > 0) {
    if (!authors.every((a) => typeof a === "string")) {
      return res.status(400).json({ error: "authors должен быть массивом строк" });
    }
    let confirmed: string[];
    try {
      confirmed = await readConfirmedAuthors();
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Failed to validate authors against confirmed list" });
    }
    const confirmedSet = new Set(confirmed);
    const unknown = (authors as string[]).filter((a) => !confirmedSet.has(a));
    if (unknown.length > 0) {
      return res.status(400).json({ error: `Не в списке подтверждённых авторов: ${unknown.join(", ")}` });
    }
    authorArgs = authors as string[];
  }

  // Spawns the WRAPPER, not check_price_updates.py directly — reuses its
  // flock (so a manual trigger can't overlap with the twice-daily cron
  // run, and — see isPriceCheckActuallyRunning above — is also what makes
  // "is it running" observable from outside this process at all) and its
  // own "job crashed" Telegram alert, same as the scheduled runs. Scripts
  // live only under src/, never compiled to dist/, so this path holds
  // regardless of dev (tsx) vs built (node dist/) execution — same
  // reasoning as author_sync.py's path in syncController.ts.
  // run_price_check.sh forwards its own argv straight through to
  // check_price_updates.py ("$@"), so extra author-name args just work.
  // Deliberately detached: this process's own lifetime (esp. under `tsx
  // watch`, which respawns it on every backend file save) must not affect
  // the scrape run — see the long comment above for exactly what goes
  // wrong when a subprocess's fate is tied to tracking state that doesn't
  // survive a restart.
  const scriptPath = path.resolve(SCRIPTS_DIR, "run_price_check.sh");
  const proc = spawn("bash", [scriptPath, ...authorArgs], {
    env: process.env,
    detached: true,
  });
  proc.unref();

  proc.stdout.on("data", (data) => {
    console.log(`[PriceCheck] ${data.toString().trim()}`);
  });
  proc.stderr.on("data", (data) => {
    console.error(`[PriceCheck Error] ${data.toString().trim()}`);
  });

  proc.on("error", (err) => {
    console.error("[PriceCheck] Failed to start subprocess:", err);
  });

  proc.on("close", (code) => {
    console.log(`[PriceCheck] Process exited with code ${code}`);
  });

  res.json({ success: true });
};
