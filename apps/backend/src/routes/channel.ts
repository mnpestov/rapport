import { Router } from "express";
import { getChannelInfo, getChannelAvatar } from "../controllers/channelController";

const router = Router();

router.get("/", getChannelInfo);
router.get("/avatar", getChannelAvatar);

export default router;
