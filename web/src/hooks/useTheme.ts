import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "modelharbor:theme";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage may be unavailable (private browsing, disabled cookies); theme still
      // applies for this page load, it just won't persist across visits.
    }
  }, [theme]);

  const toggle = (): void => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return [theme, toggle];
}
