import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ruTranslations from "./locales/ru.json";
import uzTranslations from "./locales/uz.json";

const savedLanguage = localStorage.getItem("language") || "ru";

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ruTranslations },
      uz: { translation: uzTranslations },
    },
    lng: savedLanguage,
    fallbackLng: "ru",
    interpolation: {
      escapeValue: false,
    },
  });

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("language", lng);
});

export default i18n;
