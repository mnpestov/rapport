import crypto from "crypto";

const OP_STATE_URL = "https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpState";

// Коды состояния операции у Robokassa. 50 и 100 — единственные, при которых
// деньги реально получены; именно они дают право выдать доступ.
export const ROBOKASSA_STATE = {
  NEW: 0,
  INITIATED: 5,      // деньги от покупателя не получены
  CANCELLED: 10,     // операция отменена, денег не было
  PROCESSING: 50,    // деньги получены, идёт зачисление магазину
  RETURNED: 60,      // деньги получены и возвращены покупателю
  SUSPENDED: 80,     // исполнение приостановлено
  COMPLETED: 100,    // выполнена успешно
} as const;

export type OpStateResult =
  // Robokassa ответила и знает про этот счёт.
  | { kind: "state"; stateCode: number }
  // Счёт вообще не создавался на их стороне — пользователь не дошёл до
  // страницы оплаты. Result.Code=3.
  | { kind: "not_found" }
  // Не смогли спросить (сеть, неверная подпись, неожиданный ответ).
  // Сознательно отделено от "точно не оплачено": трактовать сбой связи как
  // отказ нельзя, иначе при недоступности Robokassa мы бы закрывали живые
  // платежи как брошенные.
  | { kind: "error"; message: string };

// Ответ приходит XML-ом; тянуть парсер ради двух полей избыточно —
// вытаскиваем регулярками. Формат простой и стабильный, проверен вживую:
// <Result><Code>0</Code></Result><State><Code>100</Code>...
function extractFirst(xml: string, tag: string, section?: string): number | null {
  const scope = section
    ? xml.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1]
    : xml;
  if (!scope) return null;
  const raw = scope.match(new RegExp(`<${tag}>(\\d+)</${tag}>`))?.[1];
  return raw === undefined ? null : parseInt(raw, 10);
}

/**
 * Спрашивает Robokassa о реальном состоянии счёта. Нужно, чтобы отличить
 * "человек ушёл со страницы оплаты" от "деньги взяли, а Result URL до нас
 * не дошёл" — по нашим данным эти случаи неотличимы, оба выглядят как
 * зависший PENDING (PAYMENTS_ROBOKASSA_PLAN.md §10.4).
 */
export async function fetchOpState(invId: number): Promise<OpStateResult> {
  const merchantLogin = process.env.ROBOKASSA_MERCHANT_LOGIN;
  // Та же тестовая/боевая пара, что и везде: в тестовом режиме Robokassa
  // проверяет подпись тестовым Паролем#2.
  const testMode = process.env.ROBOKASSA_TEST_MODE === "true";
  const password2 = testMode ? process.env.ROBOKASSA_TEST_PASSWORD_2 : process.env.ROBOKASSA_PASSWORD_2;

  if (!merchantLogin || !password2) {
    return { kind: "error", message: "ROBOKASSA_MERCHANT_LOGIN or PASSWORD_2 is not configured" };
  }

  const signature = crypto
    .createHash("md5")
    .update(`${merchantLogin}:${invId}:${password2}`)
    .digest("hex");
  const url = `${OP_STATE_URL}?MerchantLogin=${encodeURIComponent(merchantLogin)}&InvoiceID=${invId}&Signature=${signature}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      return { kind: "error", message: `HTTP ${response.status} ${response.statusText}` };
    }
    const xml = await response.text();

    const resultCode = extractFirst(xml, "Code", "Result");
    if (resultCode === null) {
      return { kind: "error", message: `Unexpected response: ${xml.slice(0, 200)}` };
    }
    // 3 — "Информация об операции с таким InvoiceID не найдена".
    if (resultCode === 3) return { kind: "not_found" };
    if (resultCode !== 0) {
      return { kind: "error", message: `Robokassa Result.Code=${resultCode}` };
    }

    const stateCode = extractFirst(xml, "Code", "State");
    if (stateCode === null) {
      return { kind: "error", message: `No State.Code in response: ${xml.slice(0, 200)}` };
    }
    return { kind: "state", stateCode };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
