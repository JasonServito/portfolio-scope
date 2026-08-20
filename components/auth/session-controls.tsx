import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";

import { signOutCurrentSession } from "@/app/auth/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/session";

export async function SessionControls() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <Link
        className={buttonVariants({ variant: "outline", size: "sm" })}
        href="/auth/signin"
        prefetch={false}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Link
        aria-label="Open account settings"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
        href="/app/account"
        prefetch={false}
      >
        <UserRound className="size-4" />
        <span className="hidden sm:inline">{user.name ?? "Account"}</span>
      </Link>
      <form action={signOutCurrentSession}>
        <Button
          aria-label="Sign out"
          size="icon-sm"
          type="submit"
          variant="ghost"
        >
          <LogOut className="size-4" />
        </Button>
      </form>
    </div>
  );
}
