import { Router } from "express";
import { getChannelInfo } from "../controllers/channelController";

const router = Router();

router.get("/", getChannelInfo);

export default router;
