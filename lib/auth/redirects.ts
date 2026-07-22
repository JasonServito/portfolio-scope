export function getSafeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = "/app",
) {
  if (typeof value !== "string") return fallback;

  const path = value.trim();

  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return fallback;
  }

  return path;
}
