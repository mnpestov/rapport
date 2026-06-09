import { Request, Response } from "express";

export const telegramAuth = (req: Request, res: Response) => {
  // Логируем входящий запрос согласно требованиям
  console.log(`[Auth] Received POST /auth/telegram with body:`, req.body);

  const { initData } = req.body;

  // Базовая проверка наличия данных
  if (!initData) {
    return res.status(400).json({ error: "initData is required" });
  }

  // Возвращаем моковый успешный ответ
  res.json({
    isSubscriber: true,
    token: "mock-jwt-token",
    user: {
      telegramId: 123456,
      firstName: "Test User"
    }
  });
};
