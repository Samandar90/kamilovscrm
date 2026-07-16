/**
 * Compact display form for long generated invoice numbers.
 * "INV-1783505075738-mko2oa" -> "INV-MKO2OA"; short/custom numbers pass through.
 * Always render the full number in a `title` attribute alongside.
 */
export const shortInvoiceNumber = (number: string): string => {
  const m = number.match(/^([A-Za-z]+)-\d{6,}-([a-z0-9]+)$/i);
  if (m) return `${m[1]}-${m[2]}`.toUpperCase();
  return number;
};
