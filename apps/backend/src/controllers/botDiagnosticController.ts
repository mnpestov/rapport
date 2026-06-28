import { Request, Response } from 'express';
import { runDiagnostic } from '../services/diagnosticService';
import { prisma } from '../prismaClient';

export async function botDiagnose(req: Request, res: Response): Promise<void> {
  const { telegramId, mode, username, firstName, lastName } = req.body;

  if (typeof telegramId !== 'number') {
    res.status(400).json({ error: 'telegramId must be a number' });
    return;
  }

  if (mode !== 'diagnose' && mode !== 'diagnose-and-fix') {
    res.status(400).json({ error: 'mode must be "diagnose" or "diagnose-and-fix"' });
    return;
  }

  try {
    const result = await runDiagnostic({
      telegramId,
      mode,
      username: typeof username === 'string' ? username : undefined,
      firstName: typeof firstName === 'string' ? firstName : undefined,
      lastName: typeof lastName === 'string' ? lastName : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('[botDiagnose] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function botEscalate(req: Request, res: Response): Promise<void> {
  const { telegramId } = req.body;

  if (typeof telegramId !== 'number') {
    res.status(400).json({ error: 'telegramId must be a number' });
    return;
  }

  try {
    const updated = await prisma.whitelistedUser.updateMany({
      where: { telegramId: BigInt(telegramId) },
      data: { needsInvestigation: true },
    });

    if (updated.count === 0) {
      res.status(404).json({ error: 'User not found in whitelist' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[botEscalate] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
