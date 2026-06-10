import { Request, Response } from "express";
import { validateTelegramWebAppData } from "../utils/telegramAuth";
import { generateToken } from "../utils/jwt";
import { prisma } from "../prismaClient";
import { checkTelegramSubscription } from "../utils/checkSubscription";

export const telegramAuth = async (req: Request, res: Response) => {
  const { initData } = req.body;

  if (!initData) {
    return res.status(400).json({ error: "initData is required" });
  }

  const isDev = process.env.NODE_ENV !== "production";
  const allowDevAuth = process.env.ALLOW_DEV_AUTH === "true";

  let telegramId: number;
  let firstName: string;
  let lastName: string | undefined;
  let username: string | undefined;
  let languageCode: string | undefined;
  let isSubscriber: boolean = false;

  // DEV Mock path
  if (initData === "mock_dev" && isDev && allowDevAuth) {
    telegramId = 123456789;
    firstName = "Dev";
    lastName = "User";
    username = "devuser";
    languageCode = "ru";
    isSubscriber = true;
  } else {
    // Production HMAC validation
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      console.error("[Auth] BOT_TOKEN is not configured.");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const { isValid, user } = validateTelegramWebAppData(initData, botToken);
    
    if (!isValid || !user) {
      console.error("[Auth] Telegram validation failed or user missing.");
      return res.status(401).json({ error: "Unauthorized" });
    }

    telegramId = user.id;
    firstName = user.first_name;
    lastName = user.last_name;
    username = user.username;
    languageCode = user.language_code;
    
    // Check real channel subscription
    isSubscriber = await checkTelegramSubscription(telegramId);
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

    const token = generateToken({
      userId: userRecord.id,
      telegramId: telegramId.toString()
    });

    res.json({
      isSubscriber,
      token,
      user: {
        id: userRecord.id,
        telegramId: telegramId.toString(),
        firstName: userRecord.firstName,
      }
    });
  } catch (error) {
    console.error("[Auth] Database error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
