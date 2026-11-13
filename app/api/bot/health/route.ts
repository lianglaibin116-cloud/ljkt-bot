import { version as botVersion } from '../../../../package.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    {
      application: 'ljkt-bot',
      instance: process.env.LJKT_BOT_INSTANCE_ID ?? 'web',
      version: botVersion,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
