import { Request, Response } from "express";
import { prisma } from "../prismaClient";
import { checkTelegramSubscriptionOnce } from "../utils/checkSubscription";

export interface ChatMessage {
  id: string;
  direction: "in" | "out";
  messageType: string;
  text: string | null;
  fileId: string | null;
  timestamp: string;
}

export const getChatHistory = async (req: Request, res: Response): Promise<void> => {
  const { telegramId } = req.params;

  let tgId: bigint;
  try {
    tgId = BigInt(telegramId);
  } catch {
    res.status(400).json({ error: "Invalid telegramId" });
    return;
  }

  const [inbound, outbound] = await Promise.all([
    prisma.botInboundMessage.findMany({
      where: { telegramId: tgId },
      orderBy: { createdAt: "asc" },
    }),
    prisma.adminBotMessage.findMany({
      where: { telegramId: tgId },
      orderBy: { sentAt: "asc" },
    }),
  ]);

  const messages: ChatMessage[] = [
    ...inbound.map((m) => ({
      id: m.id,
      direction: "in" as const,
      messageType: m.messageType,
      text: m.text,
      fileId: m.fileId,
      timestamp: m.createdAt.toISOString(),
    })),
    ...outbound.map((m) => ({
      id: m.id,
      direction: "out" as const,
      messageType: "text",
      text: m.text,
      fileId: null,
      timestamp: m.sentAt.toISOString(),
    })),
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  res.json(messages);
};

export const sendChatMessage = async (req: Request, res: Response): Promise<void> => {
  const { telegramId } = req.params;
  const { text } = req.body;

  if (!text?.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }

  let tgId: bigint;
  try {
    tgId = BigInt(telegramId);
  } catch {
    res.status(400).json({ error: "Invalid telegramId" });
    return;
  }

  const botToken = process.env.BOT_TOKEN;
  const gatewayBase = process.env.TELEGRAM_GATEWAY_BASE_URL ?? "https://api.telegram.org";

  if (!botToken) {
    res.status(500).json({ error: "BOT_TOKEN not configured" });
    return;
  }

  const tgRes = await fetch(`${gatewayBase}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: telegramId, text: text.trim() }),
  });

  if (!tgRes.ok) {
    const err = await tgRes.json().catch(() => ({}));
    console.error("[Chat] sendMessage failed:", err);
    res.status(502).json({ error: "Failed to send Telegram message" });
    return;
  }

  const saved = await prisma.adminBotMessage.create({
    data: {
      telegramId: tgId,
      text: text.trim(),
      sentBy: req.user?.userId ?? null,
    },
  });

  const message: ChatMessage = {
    id: saved.id,
    direction: "out",
    messageType: "text",
    text: saved.text,
    fileId: null,
    timestamp: saved.sentAt.toISOString(),
  };

  res.status(201).json(message);
};

export const getUnreadMessages = async (_req: Request, res: Response): Promise<void> => {
  const allRows = await prisma.$queryRaw<{ telegramId: bigint; unreadCount: bigint }[]>`
    SELECT bim."telegramId", COUNT(*) AS "unreadCount"
    FROM "BotInboundMessage" bim
    LEFT JOIN "AdminChatState" acs ON acs."telegramId" = bim."telegramId"
    WHERE acs."lastReadAt" IS NULL OR bim."createdAt" > acs."lastReadAt"
    GROUP BY bim."telegramId"
    HAVING COUNT(*) > 0
  `;

  const whitelistRows = await prisma.$queryRaw<{ telegramId: bigint; unreadCount: bigint }[]>`
    SELECT bim."telegramId", COUNT(*) AS "unreadCount"
    FROM "BotInboundMessage" bim
    INNER JOIN "WhitelistedUser" wu ON wu."telegramId" = bim."telegramId"
    LEFT JOIN "AdminChatState" acs ON acs."telegramId" = bim."telegramId"
    WHERE acs."lastReadAt" IS NULL OR bim."createdAt" > acs."lastReadAt"
    GROUP BY bim."telegramId"
    HAVING COUNT(*) > 0
  `;

  const toUserList = (rows: { telegramId: bigint; unreadCount: bigint }[]) =>
    rows.map((r) => ({ telegramId: r.telegramId.toString(), unreadCount: Number(r.unreadCount) }));

  const allUsers = toUserList(allRows);
  const whitelistUsers = toUserList(whitelistRows);

  res.json({
    all: { total: allUsers.reduce((s, u) => s + u.unreadCount, 0), users: allUsers },
    whitelist: { total: whitelistUsers.reduce((s, u) => s + u.unreadCount, 0), users: whitelistUsers },
  });
};

export const getRequests = async (_req: Request, res: Response): Promise<void> => {
  const latest = await prisma.$queryRaw<{
    telegramId: bigint;
    username: string | null;
    firstName: string | null;
    lastMessageAt: Date;
    lastMessageText: string | null;
    lastMessageType: string;
  }[]>`
    SELECT DISTINCT ON (bim."telegramId")
      bim."telegramId",
      bim.username,
      bim."firstName",
      bim."createdAt" AS "lastMessageAt",
      bim.text AS "lastMessageText",
      bim."messageType" AS "lastMessageType"
    FROM "BotInboundMessage" bim
    ORDER BY bim."telegramId", bim."createdAt" DESC
  `;

  const unreadRows = await prisma.$queryRaw<{ telegramId: bigint; unreadCount: bigint }[]>`
    SELECT bim."telegramId", COUNT(*) AS "unreadCount"
    FROM "BotInboundMessage" bim
    LEFT JOIN "AdminChatState" acs ON acs."telegramId" = bim."telegramId"
    WHERE acs."lastReadAt" IS NULL OR bim."createdAt" > acs."lastReadAt"
    GROUP BY bim."telegramId"
  `;
  const unreadMap = new Map(unreadRows.map((r) => [r.telegramId.toString(), Number(r.unreadCount)]));

  const whitelistIds = await prisma.whitelistedUser.findMany({ select: { telegramId: true } });
  const whitelistSet = new Set(whitelistIds.map((w) => w.telegramId.toString()));

  const subscriptionResults = await Promise.all(
    latest.map((u) => checkTelegramSubscriptionOnce(Number(u.telegramId)).catch(() => null))
  );

  const result = latest
    .map((u, i) => ({
      telegramId: u.telegramId.toString(),
      username: u.username,
      firstName: u.firstName,
      lastMessageAt: u.lastMessageAt.toISOString(),
      lastMessageText: u.lastMessageText,
      lastMessageType: u.lastMessageType,
      unreadCount: unreadMap.get(u.telegramId.toString()) ?? 0,
      isWhitelisted: whitelistSet.has(u.telegramId.toString()),
      isSubscribed: subscriptionResults[i],
    }))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));

  res.json(result);
};

export const markChatAsRead = async (req: Request, res: Response): Promise<void> => {
  const { telegramId } = req.params;

  let tgId: bigint;
  try {
    tgId = BigInt(telegramId);
  } catch {
    res.status(400).json({ error: "Invalid telegramId" });
    return;
  }

  await prisma.adminChatState.upsert({
    where: { telegramId: tgId },
    create: { telegramId: tgId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  res.json({ ok: true });
};

export const getChatFile = async (req: Request, res: Response): Promise<void> => {
  const { fileId } = req.params;

  const botToken = process.env.BOT_TOKEN;
  const gatewayBase = process.env.TELEGRAM_GATEWAY_BASE_URL ?? "https://api.telegram.org";

  if (!botToken) {
    res.status(500).json({ error: "BOT_TOKEN not configured" });
    return;
  }

  // Resolve file_path from Telegram
  const getFileRes = await fetch(
    `${gatewayBase}/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`
  );

  if (!getFileRes.ok) {
    res.status(502).json({ error: "Failed to resolve file" });
    return;
  }

  const data = await getFileRes.json() as { ok: boolean; result?: { file_path?: string } };
  const filePath = data?.result?.file_path;

  if (!filePath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // Proxy the file
  const fileRes = await fetch(`${gatewayBase}/file/bot${botToken}/${filePath}`);

  if (!fileRes.ok) {
    res.status(502).json({ error: "Failed to fetch file" });
    return;
  }

  const contentType = fileRes.headers.get("content-type") ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=3600");

  const buffer = await fileRes.arrayBuffer();
  res.send(Buffer.from(buffer));
};
