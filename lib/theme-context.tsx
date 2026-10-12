"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { db } from "@/lib/firebase";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("skill-swap-theme");
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadTheme() {
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid));
        const savedTheme = snapshot.data()?.theme;
        if (active && (savedTheme === "light" || savedTheme === "dark")) {
          setTheme(savedTheme);
          window.localStorage.setItem("skill-swap-theme", savedTheme);
        }
      } catch {
        // Keep the locally saved preference if account data is unavailable.
      }
    }
    void loadTheme();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("skill-swap-theme", theme);
  }, [theme]);

  async function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    if (user) {
      await updateDoc(doc(db, "users", user.uid), {
        theme: nextTheme,
        updatedAt: serverTimestamp(),
      });
    }
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a <ThemeProvider>");
  return context;
}