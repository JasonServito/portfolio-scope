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
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            {eyebrow ? (
              <p className="text-sm text-muted-foreground">{eyebrow}</p>
            ) : null}
            <h1 className="mt-1 text-3xl font-medium tracking-[-0.01em] sm:text-4xl">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
        </section>

        {children}
      </div>
    </main>
  );
}
