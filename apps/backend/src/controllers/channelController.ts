import { Request, Response } from "express";
import { Readable } from "stream";
import { fetchChannelInfoFromGateway, fetchChannelAvatarFromGateway, ChannelInfo } from "../utils/gatewayApi";

let lastCache: ChannelInfo | null = null;
let lastCacheTime: number = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const FALLBACK_CHANNEL_INFO: ChannelInfo = {
  title: "Фешн хурма",
  username: "fashionhurma",
  photoUrl: "/channel/avatar",
  subscriberCount: 0,
  description: "Авторский блог о рукоделии: вязании и шитье."
};

const PROXY_HEADERS = ["content-type", "cache-control", "etag", "last-modified"] as const;

export const getChannelInfo = async (req: Request, res: Response) => {
  const now = Date.now();

  if (lastCache && now - lastCacheTime < CACHE_TTL) {
    return res.json(lastCache);
  }

  const channelInfo = await fetchChannelInfoFromGateway();

  if (channelInfo) {
    channelInfo.description = "Авторский блог о рукоделии: вязании и шитье.";
    channelInfo.photoUrl = "/channel/avatar";
    lastCache = channelInfo;
    lastCacheTime = now;
    return res.json(channelInfo);
  } else {
    const fallback = lastCache || FALLBACK_CHANNEL_INFO;
    return res.json(fallback);
  }
};

export const getChannelAvatar = async (req: Request, res: Response) => {
  const upstream = await fetchChannelAvatarFromGateway();

  if (!upstream || !upstream.ok || !upstream.body) {
    return res.status(502).json({ success: false, message: "Failed to load channel avatar" });
  }

  for (const header of PROXY_HEADERS) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }

  Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
};
