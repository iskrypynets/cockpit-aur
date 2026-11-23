import { useEffect, useState } from "react";
import { en, type TranslationKey, type TranslationMap } from "./locales/en";
import { uk } from "./locales/uk";

export type Locale = "en" | "uk";

const LOCALES: Record<Locale, TranslationMap> = { en, uk };
const STORAGE_KEY = "cockpit-yay-locale";

type Listener = (locale: Locale) => void;
const listeners = new Set<Listener>();

export function detectLocale(): Locale {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (stored === "uk") return "uk";
  } catch {
    // Ignore storage errors
  }
  return "en";
}

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  } catch {
    // Ignore storage access errors
  }
  listeners.forEach((listener) => listener(locale));
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const dictionary = LOCALES[currentLocale] || en;
  let text = dictionary[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return text;
}

export function useTranslation() {
  const [locale, setCurrent] = useState<Locale>(currentLocale);

  useEffect(() => {
    const handleLocaleChange = (newLocale: Locale) => setCurrent(newLocale);
    listeners.add(handleLocaleChange);
    return () => {
      listeners.delete(handleLocaleChange);
    };
  }, []);

  return {
    locale,
    setLocale,
    t,
  };
}
