import { Request } from "express";

// Единственное место, где перечислены "платные" поля Pattern — если тариф
// расширится, менять только здесь, а не в каждом контроллере отдельно.
// См. PAID_TIER_ROLLOUT_PLAN.md §3.1 / PAID_TIER_PERMISSIONS_PLAN.md §3.2.
//
// Только цена — для списочных ручек (getPatterns/getPatternsByIds/similar),
// где `details` и так всегда омитится безусловно (см. комментарии на местах
// использования), поэтому в премиум-гейт там попадает только price/oldPrice.
// Также используется в getPatternById для гейта PREMIUM_EXTRA — details там
// гейтится отдельно, своим собственным PREMIUM_DETAILS-флагом (details
// парсился хуже price/oldPrice, поэтому раскатывается независимо).
export const PATTERN_PRICE_OMIT = {
  price: true,
  oldPrice: true,
} as const;

// PREMIUM_CORE-гейт: плотность вязания. `yarnRanges` — отдельная relation
// (include, не omit-able поле), гейтится в месте вызова, не здесь.
export const PATTERN_CORE_OMIT = {
  densityStitches: true,
  densityRows: true,
} as const;

// PREMIUM_DETAILS-гейт: блок "Подробности" — выделен из PREMIUM_EXTRA в
// отдельное разрешение, т.к. парсился хуже остальных полей и раскатывается
// на пользователей независимо (не включён по умолчанию).
export const PATTERN_DETAILS_OMIT = {
  details: true,
} as const;

export const hasExtra = (req: Request): boolean => !!req.premium?.extra;
export const hasCore = (req: Request): boolean => !!req.premium?.core;
export const hasDetails = (req: Request): boolean => !!req.premium?.details;
