import { formatMoney } from "../lib/formatMoney";

export type ReceiptTemplateItem = {
  name: string;
  price: number;
};

export type ReceiptTemplateData = {
  clinicName: string;
  logoUrl?: string;
  patient: string;
  doctor?: string | null;
  invoiceId: string;
  date: string;
  paymentMethod: string;
  total: number;
  paid: number;
  items: ReceiptTemplateItem[];
};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMoneyUz = (value: number): string => `${formatMoney(value)} сум`;

const DEFAULT_CLINIC_LABEL = "Клиника";

// These labels should be handled by i18n at the call site
// The template is i18n-agnostic and just formats data

/** Строка «метка — значение» с точечным заполнителем, как на официальных квитанциях. */
const infoRow = (label: string, value: string): string => `
  <div style="display:flex;align-items:baseline;gap:6px;margin:3px 0;">
    <span style="flex-shrink:0;color:#333;">${escapeHtml(label)}</span>
    <span style="flex:1;border-bottom:1px dotted #999;min-width:12px;"></span>
    <span style="flex-shrink:0;text-align:right;max-width:62%;font-weight:600;overflow-wrap:break-word;">${escapeHtml(value)}</span>
  </div>`;

export function buildReceiptHTML(data: ReceiptTemplateData): string {
  const clinicName =
    data.clinicName && data.clinicName.trim() !== ""
      ? data.clinicName.trim()
      : DEFAULT_CLINIC_LABEL;

  const resolvedLogoUrl =
    data.logoUrl && data.logoUrl.trim() !== "" ? data.logoUrl.trim() : `${window.location.origin}/logo.png`;

  const doctorValue = data.doctor && data.doctor.trim() !== "" ? data.doctor : null;
  const remaining = Math.max(0, data.total - data.paid);

  const itemsRows =
    data.items.length > 0
      ? data.items
          .map(
            (item, idx) => `
        <tr>
          <td style="padding:3px 6px 3px 0;vertical-align:top;color:#555;white-space:nowrap;">${idx + 1}.</td>
          <td style="padding:3px 8px 3px 0;vertical-align:top;word-break:break-word;">${escapeHtml(item.name)}</td>
          <td style="padding:3px 0;vertical-align:top;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoneyUz(item.price))}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="3" style="padding:4px 0;text-align:center;color:#777;">—</td></tr>`;

  return `<div id="receipt" style="width:80mm;margin:0;padding:10px 12px;box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;font-size:11.5px;line-height:1.35;color:#111;background:#fff;">

      <div style="text-align:center;">
        <img src="${escapeHtml(resolvedLogoUrl)}" alt="" style="display:block;width:52px;height:52px;object-fit:contain;margin:0 auto 4px;" />
        <div style="font-weight:800;font-size:14.5px;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(clinicName)}</div>
      </div>

      <div style="border-top:2px solid #111;margin:8px 0 6px;"></div>
      <div style="text-align:center;font-weight:700;font-size:12.5px;letter-spacing:.08em;">КВИТАНЦИЯ ОБ ОПЛАТЕ</div>
      <div style="text-align:center;color:#555;font-size:10.5px;margin-top:1px;">№ ${escapeHtml(data.invoiceId)}</div>
      <div style="border-top:1px solid #111;margin:6px 0 8px;"></div>

      ${infoRow("Дата", data.date)}
      ${infoRow("Пациент", data.patient)}
      ${doctorValue ? infoRow("Врач", doctorValue) : ""}
      ${infoRow("Способ оплаты", data.paymentMethod)}

      <div style="border-top:1px solid #111;margin:8px 0 0;"></div>
      <table style="width:100%;border-collapse:collapse;font-size:11.5px;">
        <thead>
          <tr>
            <th style="padding:5px 6px 5px 0;text-align:left;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px dashed #999;">№</th>
            <th style="padding:5px 8px 5px 0;text-align:left;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px dashed #999;">Наименование услуги</th>
            <th style="padding:5px 0;text-align:right;font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px dashed #999;">Сумма</th>
          </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
      </table>
      <div style="border-top:1px solid #111;margin:2px 0 6px;"></div>

      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:4px 0;">
        <span style="font-weight:800;font-size:13px;">ИТОГО</span>
        <span style="font-weight:800;font-size:13px;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoneyUz(data.total))}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin:2px 0;">
        <span>Оплачено</span>
        <span style="font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoneyUz(data.paid))}</span>
      </div>
      ${
        remaining > 0.004
          ? `<div style="display:flex;justify-content:space-between;margin:2px 0;">
               <span>Остаток к оплате</span>
               <span style="font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(formatMoneyUz(remaining))}</span>
             </div>`
          : ""
      }

      <div style="border-top:2px solid #111;margin:9px 0 7px;"></div>
      <div style="text-align:center;font-weight:600;">Спасибо за визит!</div>
      <div style="text-align:center;color:#777;font-size:9.5px;margin-top:5px;">
        Внутренний документ · не является фискальным чеком
      </div>
    </div>`;
}
