/** Process liveness only: not proof of database/model readiness or SaaS safety. */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', check: 'liveness' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
