"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
}

// Undefined until hydration, because only the browser knows the theme.
export function useTheme() {
  return useSyncExternalStore<"light" | "dark" | undefined>(
    subscribe,
    () =>
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    () => undefined,
  );
}

// The inline theme script in the root layout handles the click.
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme();

  return (
    <Button
      aria-label="Dark mode"
      aria-pressed={theme === "dark"}
      className={className}
      data-theme-toggle=""
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <Moon aria-hidden="true" className="size-4 dark:hidden" />
      <Sun aria-hidden="true" className="hidden size-4 dark:block" />
    </Button>
  );
}
