import { Request, Response } from "express";
import { fetchChannelInfoFromGateway, ChannelInfo } from "../utils/gatewayApi";

let lastCache: ChannelInfo | null = null;
let lastCacheTime: number = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const FALLBACK_CHANNEL_INFO: ChannelInfo = {
  title: "Фешн хурма",
  username: "fashionhurma",
  photoUrl: null,
  subscriberCount: 0,
  description: "Авторский блог о рукоделии: вязании и шитье."
};

export const getChannelInfo = async (req: Request, res: Response) => {
  const now = Date.now();

  if (lastCache && now - lastCacheTime < CACHE_TTL) {
    return res.json(lastCache);
  }

  const channelInfo = await fetchChannelInfoFromGateway();

  if (channelInfo) {
    channelInfo.description = "Авторский блог о рукоделии: вязании и шитье.";
    lastCache = channelInfo;
    lastCacheTime = now;
    return res.json(channelInfo);
  } else {
    // Gateway failed or endpoint does not exist yet.
    // Use lastCache if available, otherwise minimal fallback.
    const fallback = lastCache || FALLBACK_CHANNEL_INFO;
    return res.json(fallback);
  }
};
