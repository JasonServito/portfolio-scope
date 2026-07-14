const headers = {
  "Cache-Control": "no-store, max-age=0",
};

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      service: "portfolioscope",
      timestamp: new Date().toISOString(),
    },
    { headers },
  );
}
