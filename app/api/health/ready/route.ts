import { join } from "node:path";
import { ready } from "../../../../lib/readiness";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET() {
  const ok = ready(process.env.HRIS_DATA_DIR || join(process.cwd(), "data"));
  return Response.json(
    { status: ok ? "ready" : "unavailable" },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
