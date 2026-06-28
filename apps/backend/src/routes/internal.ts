import { Router } from 'express';
import { requireBotApiKey } from '../middlewares/requireBotApiKey';
import { botDiagnose, botEscalate } from '../controllers/botDiagnosticController';

const router = Router();

router.post('/bot/diagnose', requireBotApiKey, botDiagnose);
router.post('/bot/escalate', requireBotApiKey, botEscalate);

export default router;
