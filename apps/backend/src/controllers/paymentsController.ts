import crypto from "crypto";
import { Request, Response } from "express";
import { PaywallSource } from "@prisma/client";
import { prisma } from "../prismaClient";
import { completePayment } from "../services/paymentCompletion";
import { sendPaymentAlert } from "../services/paymentAlerts";

const SUBSCRIPTION_PRICE_RUB = 69;
const SUBSCRIPTION_DESCRIPTION = "Подписка Rapport, 1 месяц";
const ROBOKASSA_PAYMENT_URL = "https://auth.robokassa.ru/Merchant/Index.aspx";

// Всегда передаём Receipt, даже если для самозанятых через "Робочеки СМЗ"
// это может оказаться необязательным — см. PAYMENTS_ROBOKASSA_PLAN.md §3.3a.
// tax: "none" — самозанятые (НПД) не плательщики НДС.
function buildReceiptJson(): string {
  return JSON.stringify({
    items: [
      {
        name: SUBSCRIPTION_DESCRIPTION,
        quantity: 1,
        sum: SUBSCRIPTION_PRICE_RUB,
        tax: "none",
      },
    ],
  });
}

// POST /payments/create — создаёт Payment (PENDING) и возвращает подписанную
// ссылку на оплату. Сумма — константа на бэкенде, не принимается от клиента
// (см. PAYMENTS_ROBOKASSA_PLAN.md §7, шаг 2).
export const createPayment = async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.userId;
  // Откуда пользователь пришёл к оплате — приходит от фронта вместе с
  // вариантом открытой шторки. Задним числом источник не восстановить
  // (§10.3), поэтому пишем сразу; невалидное/отсутствующее значение просто
  // не сохраняем, а не роняем оплату из-за аналитики.
  const rawSource = req.body?.source;
  const source =
    typeof rawSource === "string" && (Object.values(PaywallSource) as string[]).includes(rawSource)
      ? (rawSource as PaywallSource)
      : null;

  const merchantLogin = process.env.ROBOKASSA_MERCHANT_LOGIN;
  // Тестовый и боевой контуры Robokassa проверяют подпись по разным парам
  // паролей из личного кабинета — при IsTest=1 нужен именно
  // ROBOKASSA_TEST_PASSWORD_1, боевой Password#1 там не подойдёт (даёт
  // "Error code: 29 No payment methods available", ранее найдено вживую).
  const testMode = process.env.ROBOKASSA_TEST_MODE === "true";
  const password1 = testMode ? process.env.ROBOKASSA_TEST_PASSWORD_1 : process.env.ROBOKASSA_PASSWORD_1;
  if (!merchantLogin || !password1) {
    console.error(
      `[Payments] ROBOKASSA_MERCHANT_LOGIN or ROBOKASSA_${testMode ? "TEST_" : ""}PASSWORD_1 is not configured.`
    );
    res.status(500).json({ error: "Payments are not configured" });
    return;
  }

  try {
    const payment = await prisma.payment.create({
      data: {
        userId,
        amount: SUBSCRIPTION_PRICE_RUB,
        status: "PENDING",
        source,
      },
    });

    const outSum = SUBSCRIPTION_PRICE_RUB.toFixed(2);
    const invId = payment.invId;

    // Receipt участвует в подписи СЫРЫМ JSON, без URL-кодирования — этим
    // и была вызвана Error code 29 на первом прод-прогоне (шаг 6,
    // 2026-08-19): раньше здесь стоял encodeURIComponent(receiptJson).
    // Найдено и независимо подтверждено по исходникам официального PHP SDK
    // Robokassa (`kvalood/Robokassa`, `Robokassa.php`): подпись — всегда
    // `md5("$login:$price:$invId:$receipt:$pass1")`, где `$receipt =
    // json_encode(...)` без urlencode; urlencode применяется отдельно,
    // только при вставке значения в саму форму/URL (см. queryString ниже —
    // там `receiptJson` кодируется точно так же, как остальные параметры).
    const receiptJson = buildReceiptJson();

    const signatureSource = `${merchantLogin}:${outSum}:${invId}:${receiptJson}:${password1}`;
    const signatureValue = crypto.createHash("md5").update(signatureSource).digest("hex");

    const queryParams: [string, string][] = [
      ["MerchantLogin", merchantLogin],
      ["OutSum", outSum],
      ["InvId", String(invId)],
      ["Description", SUBSCRIPTION_DESCRIPTION],
      ["Receipt", receiptJson],
      ["SignatureValue", signatureValue],
    ];
    if (testMode) {
      queryParams.push(["IsTest", "1"]);
    }

    const queryString = queryParams
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    const paymentUrl = `${ROBOKASSA_PAYMENT_URL}?${queryString}`;

    res.status(201).json({ paymentUrl });
  } catch (error) {
    console.error("[Payments] createPayment failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// POST /payments/robokassa/result — Result URL, вызывается сервером
// Robokassa напрямую (не пользователем, без JWT). Единственное место, где
// реально выдаётся доступ — см. PAYMENTS_ROBOKASSA_PLAN.md §3.3. Ответ
// должен быть строго телом "OK{invId}", без пробела — иначе Robokassa
// сочтёт уведомление необработанным и будет повторять запрос.
export const handleRobokassaResult = async (req: Request, res: Response): Promise<void> => {
  // Та же тестовая/боевая пара паролей, что и в createPayment — Robokassa
  // подписывает вызов Result URL тестовым Password#2, пока платёж шёл через
  // IsTest=1, а не боевым.
  const testMode = process.env.ROBOKASSA_TEST_MODE === "true";
  const password2 = testMode ? process.env.ROBOKASSA_TEST_PASSWORD_2 : process.env.ROBOKASSA_PASSWORD_2;
  if (!password2) {
    console.error(`[Payments] ROBOKASSA_${testMode ? "TEST_" : ""}PASSWORD_2 is not configured.`);
    res.status(500).send("Payments are not configured");
    return;
  }

  const { OutSum, InvId, SignatureValue } = req.body ?? {};
  if (typeof OutSum !== "string" || typeof InvId !== "string" || typeof SignatureValue !== "string") {
    console.error("[Payments] Result URL: missing OutSum/InvId/SignatureValue in body", req.body);
    res.status(400).send("Missing required fields");
    return;
  }

  const expectedSignature = crypto
    .createHash("md5")
    .update(`${OutSum}:${InvId}:${password2}`)
    .digest("hex");

  // Сравнение без учёта регистра (документация описывает подпись как
  // hex-строку в верхнем регистре, наш crypto.createHash даёт нижний) и
  // constant-time (timingSafeEqual) — обычное `!==` на секрете, пришедшем
  // по сети, теоретически позволяет подбирать Пароль#2 по времени ответа.
  const expectedBuf = Buffer.from(expectedSignature.toLowerCase());
  const receivedBuf = Buffer.from(SignatureValue.toLowerCase());
  const signatureValid =
    expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
  if (!signatureValid) {
    console.error(
      `[Payments] Result URL: signature mismatch for InvId=${InvId}. ` +
        `Someone forged the request, or Password#2 is wrong.`
    );
    // Самый опасный из сигналов: если разъехались пароли, Robokassa
    // принимает деньги, а мы отвергаем все уведомления и никому не выдаём
    // доступ. Молча в лог такое писать нельзя (§10.5).
    void sendPaymentAlert(
      "result-signature-mismatch",
      `Result URL отверг уведомление по InvId=${InvId}: не сошлась подпись.\n\n` +
        `Либо кто-то подделал запрос, либо Пароль#2 в .env разошёлся с личным кабинетом. ` +
        `Во втором случае оплаты проходят у Robokassa, но доступ не выдаётся.`
    );
    res.status(400).send("Invalid signature");
    return;
  }

  const invId = parseInt(InvId, 10);
  if (!Number.isInteger(invId)) {
    res.status(400).send("Invalid InvId");
    return;
  }

  try {
    const payment = await prisma.payment.findUnique({
      where: { invId },
      include: { user: true },
    });
    if (!payment) {
      console.error(`[Payments] Result URL: no Payment found for InvId=${invId}`);
      res.status(400).send("Payment not found");
      return;
    }

    // Идемпотентность — Robokassa повторяет запрос, если не получила
    // "OK{invId}" вовремя. Повторный приход уже обработанного платежа не
    // должен второй раз сдвигать premiumExpiresAt/отправлять чек.
    if (payment.status === "PAID") {
      res.status(200).send(`OK${invId}`);
      return;
    }

    // Готча: в тестовом режиме OutSum приходит с 2 знаками после запятой,
    // в боевом — с 6 (см. §3.3) — сравниваем как числа, не как строки.
    const outSumNumber = parseFloat(OutSum);
    if (Math.abs(outSumNumber - Number(payment.amount)) > 0.01) {
      console.error(
        `[Payments] Result URL: OutSum mismatch for InvId=${invId}. ` +
          `Expected ${payment.amount}, got ${OutSum}.`
      );
      res.status(400).send("Amount mismatch");
      return;
    }

    // Выдача доступа живёт в completePayment (services/paymentCompletion.ts),
    // а не здесь: ровно ту же функцию вызывает сверка с Robokassa
    // (scripts/reconcilePayments.ts) для платежей, по которым уведомление
    // до нас не дошло. Две копии этой логики со временем разошлись бы.
    const result = await completePayment(payment, outSumNumber);
    if (result.outcome === "already_paid") {
      console.log(`[Payments] Result URL: InvId=${invId} already claimed by a concurrent request — no-op.`);
    }

    res.status(200).send(`OK${invId}`);
  } catch (error) {
    console.error(`[Payments] Result URL handler failed for InvId=${invId}:`, error);
    res.status(500).send("Internal server error");
  }
};
