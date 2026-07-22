import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <LockKeyhole className="mb-2 size-6 text-muted-foreground" />
          <CardTitle className="text-xl">Administrator access required</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="leading-6 text-muted-foreground">
            Your identity is valid, but this route requires the server-controlled
            ADMIN role.
          </p>
          <Link className={buttonVariants()} href="/app">
            Return to your workspace
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
