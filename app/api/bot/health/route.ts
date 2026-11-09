export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      application: 'ljkt-bot',
      instance: process.env.LJKT_BOT_INSTANCE_ID ?? 'web',
      version: '0.2.0',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
