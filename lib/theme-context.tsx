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

  // 1. Sync with localStorage on initial mount
  useEffect(() => {
    const storedTheme = window.localStorage.getItem("skill-swap-theme");
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
  }, []);

  // 2. Sync with Firestore when user logs in
  useEffect(() => {
    if (!user) return;
    
    // Capture the UID explicitly to satisfy TypeScript inside the async block
    const userId = user.uid;
    let active = true;

    async function loadTheme() {
      try {
        const snapshot = await getDoc(doc(db, "users", userId));
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
    return () => {
      active = false;
    };
  }, [user]);

  // 3. Apply theme classes to DOM
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("skill-swap-theme", theme);
  }, [theme]);

  // 4. Toggle theme function
  async function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);

    // Explicitly check for user existence before accessing properties
    if (user && user.uid) {
      await updateDoc(doc(db, "users", user.uid), {
        theme: nextTheme,
        updatedAt: serverTimestamp(),
      });
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a <ThemeProvider>");
  return context;
}
