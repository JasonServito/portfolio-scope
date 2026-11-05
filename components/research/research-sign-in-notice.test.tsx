import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ResearchSignInNotice } from "@/components/research/research-sign-in-notice";

vi.stubGlobal("React", React);

describe("research sign-in notice", () => {
  it("asks signed-out visitors to sign in and return to their research", () => {
    const markup = renderToStaticMarkup(<ResearchSignInNotice />);

    expect(markup).toContain("<h2");
    expect(markup).toContain(
      "Research reports are available when you&#x27;re signed in",
    );
    expect(markup).toContain(
      'href="/auth/signin?callbackUrl=%2Fapp%2Fresearch"',
    );
    expect(markup).toContain(">Sign in<");
    expect(markup).not.toContain("/app/research\"");
  });

  it("renders the page heading level when asked", () => {
    const markup = renderToStaticMarkup(
      <ResearchSignInNotice headingLevel={1} />,
    );

    expect(markup).toContain("<h1");
    expect(markup).not.toContain("<h2");
  });

  it("points signed-in users to their own research", () => {
    const markup = renderToStaticMarkup(<ResearchSignInNotice signedIn />);

    expect(markup).toContain("Your research reports are in your workspace");
    expect(markup).toContain('href="/app/research"');
    expect(markup).toContain(">Open your research<");
    expect(markup).not.toContain("/auth/signin");
  });
});
