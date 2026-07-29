import { requestJson } from "../../../api/http";

export type UziTemplateCategory =
  | "obstetrics"
  | "gynecology"
  | "breast"
  | "urology"
  | "abdomen"
  | "thyroid";

export type UziTemplateSummary = {
  id: string;
  title: string;
  category: UziTemplateCategory;
};

export type UziTemplate = UziTemplateSummary & {
  /** Тело протокола: доверенный HTML с сервера (константа в коде, не пользовательский ввод). */
  html: string;
};

export type UziTemplatesListResponse = {
  enabled: boolean;
  templates: UziTemplateSummary[];
};

export const UZI_CATEGORY_LABELS: Record<UziTemplateCategory, string> = {
  obstetrics: "Акушерство",
  gynecology: "Гинекология",
  breast: "Молочные железы",
  urology: "Мочевыделительная система",
  abdomen: "Брюшная полость",
  thyroid: "Щитовидная железа",
};

export const uziTemplatesApi = {
  list: (token: string, doctorId: number) =>
    requestJson<UziTemplatesListResponse>(`/api/uzi-templates?doctorId=${doctorId}`, { token }),

  getById: (token: string, doctorId: number, templateId: string) =>
    requestJson<UziTemplate>(
      `/api/uzi-templates/${encodeURIComponent(templateId)}?doctorId=${doctorId}`,
      { token }
    ),
};
