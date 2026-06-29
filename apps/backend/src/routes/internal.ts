import { Router } from 'express';
import { requireBotApiKey } from '../middlewares/requireBotApiKey';
import { botDiagnose, botEscalate } from '../controllers/botDiagnosticController';
import { saveBotMessage } from '../controllers/botMessageController';

const router = Router();

router.post('/bot/diagnose', requireBotApiKey, botDiagnose);
router.post('/bot/escalate', requireBotApiKey, botEscalate);
router.post('/bot/message', requireBotApiKey, saveBotMessage);

export default router;
