import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { themeScript } from "@/lib/theme";

class FakeElement {
  constructor(private readonly toggle: boolean) {}
  closest(selector: string) {
    return this.toggle && selector === "[data-theme-toggle]" ? this : null;
  }
}

function runThemeScript({
  stored,
  storageBlocked = false,
}: {
  stored?: string;
  storageBlocked?: boolean;
} = {}) {
  const classes = new Set<string>();
  const storage = new Map(stored ? [["theme", stored]] : []);
  const listeners: Record<string, (event: unknown) => void> = {};
  const localStorage = {
    getItem(key: string) {
      if (storageBlocked) throw new Error("blocked");
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (storageBlocked) throw new Error("blocked");
      storage.set(key, value);
    },
  };

  runInNewContext(themeScript, {
    Element: FakeElement,
    localStorage,
    document: {
      documentElement: {
        classList: {
          contains: (name: string) => classes.has(name),
          toggle: (name: string, force: boolean) =>
            force ? classes.add(name) : classes.delete(name),
        },
      },
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
    },
    window: {
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
    },
  });

  return {
    isDark: () => classes.has("dark"),
    stored: () => storage.get("theme"),
    click: (toggle = true) =>
      listeners.click({ target: new FakeElement(toggle) }),
    otherTabChose: (value: string | null) =>
      listeners.storage({ key: "theme", newValue: value }),
  };
}

describe("inline theme script", () => {
  it("starts dark until a theme is chosen", () => {
    expect(runThemeScript().isDark()).toBe(true);
  });

  it("keeps a saved light choice", () => {
    expect(runThemeScript({ stored: "light" }).isDark()).toBe(false);
  });

  it("switches and remembers the theme when the toggle is clicked", () => {
    const page = runThemeScript();

    page.click(false);
    expect(page.isDark()).toBe(true);

    page.click();
    expect(page.isDark()).toBe(false);
    expect(page.stored()).toBe("light");

    page.click();
    expect(page.isDark()).toBe(true);
    expect(page.stored()).toBe("dark");
  });

  it("follows a choice made in another tab", () => {
    const page = runThemeScript();

    page.otherTabChose("light");
    expect(page.isDark()).toBe(false);

    page.otherTabChose(null);
    expect(page.isDark()).toBe(true);
  });

  it("still switches when storage is unavailable", () => {
    const page = runThemeScript({ storageBlocked: true });
    expect(page.isDark()).toBe(true);

    page.click();
    expect(page.isDark()).toBe(false);
  });
});
