import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ruTranslations from "./locales/ru.json";
import uzTranslations from "./locales/uz.json";

// Try to get saved language from localStorage, with fallback to 'ru'
let savedLanguage = "ru";
try {
  const stored = typeof window !== "undefined" ? localStorage.getItem("language") : null;
  if (stored && (stored === "ru" || stored === "uz")) {
    savedLanguage = stored;
  }
} catch {
  // localStorage might be unavailable in some environments
  savedLanguage = "ru";
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ruTranslations },
    uz: { translation: uzTranslations },
  },
  lng: savedLanguage,
  fallbackLng: "ru",
  interpolation: {
    escapeValue: false,
  },
  react: {
    useSuspense: false,
  },
});

// Save language preference when it changes
i18n.on("languageChanged", (lng) => {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem("language", lng);
    }
  } catch {
    // localStorage might be unavailable
  }
});

export default i18n;
