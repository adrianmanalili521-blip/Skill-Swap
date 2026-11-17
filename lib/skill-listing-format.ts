export const DEFAULT_SKILL_DURATION_MINUTES = 60;
export const SKILL_PRICE_CURRENCY = "PHP";

const phpFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: SKILL_PRICE_CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatSkillPrice(price?: number | null) {
  if (price === undefined || price === null) return "Price not set";
  return price === 0 ? "Free" : phpFormatter.format(price);
}
