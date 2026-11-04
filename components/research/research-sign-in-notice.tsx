import Link from "next/link";
import { FileText, LockKeyhole } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

const signInHref = `/auth/signin?${new URLSearchParams({
  callbackUrl: "/app/research",
})}`;

// Research reports are a signed-in feature; public pages show this instead.
export function ResearchSignInNotice({
  headingLevel = 2,
  signedIn = false,
}: {
  headingLevel?: 1 | 2;
  signedIn?: boolean;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const Icon = signedIn ? FileText : LockKeyhole;

  return (
    <div className="flex flex-col items-center rounded-2xl border bg-muted/30 px-6 py-12 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-background text-muted-foreground shadow-sm">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Heading className="mt-4 text-lg font-semibold text-balance">
        {signedIn
          ? "Your research reports are in your workspace"
          : "Research reports are available when you're signed in"}
      </Heading>
      <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
        A research report sums up a company&apos;s strengths, risks, and what
        to watch, with the source behind each point.
      </p>
      <Link
        className={buttonVariants({ className: "mt-5" })}
        href={signedIn ? "/app/research" : signInHref}
        prefetch={false}
      >
        {signedIn ? "Open your research" : "Sign in"}
      </Link>
    </div>
  );
}
