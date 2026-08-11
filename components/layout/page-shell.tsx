import { Badge } from "@/components/ui/badge";

type PageShellProps = {
  eyebrow?: string;
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
};

export function PageShell({
  actions,
  children,
  description,
  eyebrow,
  title,
}: PageShellProps) {
  return (
    <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-3xl space-y-2">
            {eyebrow ? <Badge variant="outline">{eyebrow}</Badge> : null}
            <div>
              <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </section>

        {children}
      </div>
    </main>
  );
}
