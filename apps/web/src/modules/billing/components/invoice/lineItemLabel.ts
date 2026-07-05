/**
 * Human-readable label for line item (fallback for synthetic API strings).
 * Note: Translation happens at call site using i18n.
 */
export const lineItemDisplayLabel = (description: string): string => {
  const t = description.trim();
  if (t === "Invoice total") {
    return "billing.invoiceTotal";
  }
  return t;
};
