import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./en.json";
import he from "./he.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      he: { translation: he },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "he"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "lang",
    },
    interpolation: { escapeValue: false },
  });

export function setLanguage(lang: "en" | "he") {
  i18n.changeLanguage(lang);
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
}

// Apply dir on init
const savedLang = localStorage.getItem("lang") || "en";
document.documentElement.dir = savedLang === "he" ? "rtl" : "ltr";
document.documentElement.lang = savedLang;

export default i18n;
