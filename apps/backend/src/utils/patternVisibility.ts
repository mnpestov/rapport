import { UserRole } from "@prisma/client";

// Единственное место, где перечислены "платные" поля Pattern — если тариф
// расширится, менять только здесь, а не в каждом контроллере отдельно.
// См. PAID_TIER_ROLLOUT_PLAN.md §3.1.
//
// Полный набор — для ручек, которые в принципе способны отдать `details`
// (сейчас только getPatternById: список всегда омитит details ради веса
// ответа, для ЛЮБОЙ роли — см. PATTERN_PRICE_OMIT ниже).
export const PATTERN_PREMIUM_OMIT = {
  price: true,
  oldPrice: true,
  details: true,
} as const;

// Только цена — для списочных ручек (getPatterns/getPatternsByIds/similar),
// где `details` и так всегда омитится безусловно (см. комментарии на местах
// использования), поэтому в премиум-гейт там попадает только price/oldPrice.
export const PATTERN_PRICE_OMIT = {
  price: true,
  oldPrice: true,
} as const;

export const isAdminRole = (role: UserRole | null | undefined): boolean =>
  role === UserRole.ADMIN;
