// Shared by PatternCard, PatternDetails, and clientPatternFilters — was
// duplicated inline in the first two already; adding a third/fourth copy
// for the discount quick-filter was the trigger to consolidate instead.

export interface PriceLike {
  isFree: boolean;
  price?: string | null;
  oldPrice?: string | null;
}

// A price of exactly 0 means the item is free (see the scraper's
// normalize_free_price) — isFree already covers that, so a genuinely
// displayable price also requires > 0. isFree can also be a manual admin
// decision independent of the stored price, so it's checked directly too.
export function hasVisiblePrice(pattern: PriceLike): boolean {
  return !pattern.isFree && pattern.price != null && parseFloat(pattern.price) > 0;
}

// oldPrice only counts as an active discount when it's genuinely higher
// than the current price — guards against a data-entry mistake reading as
// a price INCREASE instead of a markdown. Implies hasVisiblePrice, so this
// and isFree are naturally mutually exclusive — no extra check needed
// anywhere that renders both a "Скидка" and a "Бесплатно" badge.
export function hasActiveDiscount(pattern: PriceLike): boolean {
  return hasVisiblePrice(pattern) && pattern.oldPrice != null && parseFloat(pattern.oldPrice) > parseFloat(pattern.price as string);
}
