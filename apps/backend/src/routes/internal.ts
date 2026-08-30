import { Router } from 'express';
import { requireBotApiKey } from '../middlewares/requireBotApiKey';
import { botDiagnose, botEscalate } from '../controllers/botDiagnosticController';
import { saveBotMessage } from '../controllers/botMessageController';
import { submitBotAuthorApplication, getBotApplicationStatus } from '../controllers/authorApplicationController';

const router = Router();

router.post('/bot/diagnose', requireBotApiKey, botDiagnose);
router.post('/bot/escalate', requireBotApiKey, botEscalate);
router.post('/bot/message', requireBotApiKey, saveBotMessage);
// telegramId in the body, not query — query strings can end up in proxy
// access logs (see implementation_plan.md §4.2).
router.post('/bot/author-application', requireBotApiKey, submitBotAuthorApplication);
router.post('/bot/author-application/status', requireBotApiKey, getBotApplicationStatus);

export default router;
