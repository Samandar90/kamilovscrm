/**
 * Human-readable label for line item (fallback for synthetic API strings).
 * Only the known synthetic string is translated; real descriptions pass through
 * untouched (never fed to t() — they may contain ":" which i18next parses).
 */
export const lineItemDisplayLabel = (
  description: string,
  t: (key: string) => string
): string => {
  const trimmed = description.trim();
  if (trimmed === "Invoice total") {
    return t("billing.invoiceTotal");
  }
  return trimmed;
};
