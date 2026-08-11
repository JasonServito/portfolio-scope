import { Badge } from "@/components/ui/badge";

export function PublicContent({
  children,
  description,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <>
      <section className="border-b bg-muted/35">
        <div className="mx-auto w-full max-w-7xl px-6 py-14 sm:py-18 lg:px-8">
          <Badge variant="outline">{eyebrow}</Badge>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            {description}
          </p>
        </div>
      </section>
      <div className="mx-auto w-full max-w-7xl px-6 py-12 lg:px-8">
        {children}
      </div>
    </>
  );
}
