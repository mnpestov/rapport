import { Router } from 'express';
import { requireBotApiKey } from '../middlewares/requireBotApiKey';
import { botDiagnose } from '../controllers/botDiagnosticController';

const router = Router();

router.post('/bot/diagnose', requireBotApiKey, botDiagnose);

export default router;
