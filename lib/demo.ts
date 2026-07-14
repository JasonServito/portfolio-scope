export const DEMO_MODE = true;

export const demoPortfolioName = "Recruiter Demo Portfolio";

export const demoReadOnlyMessage = "The public demo is read-only.";

export function isPublicDemoReadOnly() {
  return process.env.NODE_ENV === "production";
}
