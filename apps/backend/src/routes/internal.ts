import { Router } from 'express';
import { requireBotApiKey } from '../middlewares/requireBotApiKey';
import { botDiagnose, botEscalate } from '../controllers/botDiagnosticController';
import { saveBotMessage } from '../controllers/botMessageController';
import { submitBotAuthorApplication, getBotApplicationStatus, respondToApplication } from '../controllers/authorApplicationController';
import { createUserCredential, lookupUserCredential } from '../controllers/userCredentialController';

const router = Router();

router.post('/bot/diagnose', requireBotApiKey, botDiagnose);
router.post('/bot/escalate', requireBotApiKey, botEscalate);
router.post('/bot/message', requireBotApiKey, saveBotMessage);
// telegramId in the body, not query — query strings can end up in proxy
// access logs (see implementation_plan.md §4.2).
router.post('/bot/author-application', requireBotApiKey, submitBotAuthorApplication);
router.post('/bot/author-application/status', requireBotApiKey, getBotApplicationStatus);
router.post('/bot/author-application/respond', requireBotApiKey, respondToApplication);

// Self-serve учётка для входа на сайт (BROWSER_ACCESS_PLAN.md §3.6).
// telegramId в теле — та же причина, что и у заявок выше.
router.post('/bot/user-credentials', requireBotApiKey, createUserCredential);
router.post('/bot/user-credentials/lookup', requireBotApiKey, lookupUserCredential);

export default router;
