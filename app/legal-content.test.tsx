import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import DisclaimerPage from "@/app/disclaimer/page";
import PrivacyPage from "@/app/privacy/page";

vi.stubGlobal("React", React);

describe("public legal content", () => {
  it("states the financial and AI limitations", () => {
    const markup = renderToStaticMarkup(<DisclaimerPage />);

    expect(markup).toContain("informational and educational purposes only");
    expect(markup).toContain("financial, investment, legal, or tax advice");
    expect(markup).toContain("Make your own decisions");
    expect(markup).toContain("delayed, incomplete, inaccurate");
    expect(markup).toContain("AI-generated or AI-assisted");
    expect(markup).toContain("mistakes, omissions, or outdated information");
    expect(markup).toContain("sole basis for investment decisions");
  });

  it("explains the account and user-created data used to operate the app", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);

    expect(markup).toContain("OAuth providers such as GitHub and Google");
    expect(markup).toContain("provide and operate the app");
    expect(markup).toContain("name, email address, OAuth provider identity");
    expect(markup).toContain("portfolios, holdings, watchlist items");
    expect(markup).toContain("alerts, and research history");
    expect(markup).toContain('href="/privacy"');
    expect(markup).toContain('href="/disclaimer"');
  });
});
