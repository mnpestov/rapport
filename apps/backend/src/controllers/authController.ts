import { Request, Response } from "express";
import { validateTelegramWebAppData } from "../utils/telegramAuth";
import { generateToken } from "../utils/jwt";
import { prisma } from "../prismaClient";
import { checkTelegramSubscription } from "../utils/checkSubscription";

export const telegramAuth = async (req: Request, res: Response) => {
  console.log("[AUTH] Request started");

  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ error: "initData is required" });
  }

  console.log(`[AUTH] initData received, length=${String(initData).length}`);

  const allowDevAuth = process.env.ALLOW_DEV_AUTH === "true";

  let telegramId: number;
  let firstName: string;
  let lastName: string | undefined;
  let username: string | undefined;
  let languageCode: string | undefined;
  let isSubscriber: boolean = false;

  // DEV Mock path
  if (initData === "mock_dev" && allowDevAuth) {
    telegramId = 123456789;
    firstName = "Dev";
    lastName = "User";
    username = "devuser";
    languageCode = "ru";
    isSubscriber = true;
    console.log("[AUTH] Telegram validation OK (dev mock)");
    console.log(`[AUTH] telegramId=${telegramId} username=${username} firstName=${firstName} lastName=${lastName}`);
  } else {
    // Production HMAC validation
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error("[Auth] BOT_TOKEN is not configured.");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const { isValid, user } = validateTelegramWebAppData(initData, botToken);

    if (!isValid || !user) {
      console.error("[AUTH] Telegram validation FAILED");
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log("[AUTH] Telegram validation OK");
    console.log(`[AUTH] telegramId=${user.id} username=${user.username ?? null} firstName=${user.first_name} lastName=${user.last_name ?? null}`);

    telegramId = user.id;
    firstName = user.first_name;
    lastName = user.last_name;
    username = user.username;
    languageCode = user.language_code;

    console.log(`[AUTH] Checking subscription telegramId=${telegramId} username=${username ?? null}`);

    // Check real channel subscription
    isSubscriber = await checkTelegramSubscription(telegramId);

    console.log(`[AUTH] Subscription result telegramId=${telegramId} username=${username ?? null} isSubscriber=${isSubscriber}`);
  }

  try {
    // Upsert user in database
    const userRecord = await prisma.user.upsert({
      where: { telegramId: BigInt(telegramId) },
      update: {
        firstName,
        lastName,
        username,
        languageCode,
      },
      create: {
        telegramId: BigInt(telegramId),
        firstName,
        lastName,
        username,
        languageCode,
      },
    });

    console.log(`[AUTH] User upsert completed dbUserId=${userRecord.id} telegramId=${telegramId}`);

    const token = generateToken({
      userId: userRecord.id,
      telegramId: telegramId.toString()
    });

    console.log(`[AUTH] JWT generated telegramId=${telegramId}`);

    const responseBody = {
      isSubscriber,
      token,
      user: {
        id: userRecord.id,
        telegramId: telegramId.toString(),
        firstName: userRecord.firstName,
      }
    };

    console.log("[AUTH] Response:");
    console.dir(responseBody, { depth: null });

    res.json(responseBody);
  } catch (error) {
    console.error("[AUTH] Unexpected error");
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
};
