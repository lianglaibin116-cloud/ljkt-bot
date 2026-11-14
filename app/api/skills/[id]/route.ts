/** Download the LJKT skill, a builtin agent skill, or one owner skill as zip. */
import type { NextRequest } from 'next/server';

import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { findUserSkill } from '@/lib/server/agent-runtime/user-skills';
import { withRequestOwnerId } from '@/lib/server/agent-runtime/with-owner';
import {
  buildBuiltinSkillZip,
  buildLJKTSkillZip,
  buildUserSkillZip,
  isSafeSkillId,
} from '@/lib/server/skill-export';

export const runtime = 'nodejs';

function zipResponse(id: string, zip: Buffer, headers = new Headers()): Response {
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', `attachment; filename="${id}-skill.zip"`);
  headers.set('Cache-Control', 'no-store');
  return new Response(new Uint8Array(zip), { headers });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAgentRuntimeConfigured()) return new Response('Not found', { status: 404 });
  const { id } = await params;
  if (!isSafeSkillId(id)) return new Response('Invalid skill id', { status: 400 });

  // Keep the old endpoint as an API alias for already installed clients. The
  // downloaded archive itself is branded and rooted as `ljkt/`.
  if (id === 'ljkt' || id === 'openmaic') {
    const zip = await buildLJKTSkillZip();
    return zip ? zipResponse('ljkt', zip) : new Response('Not found', { status: 404 });
  }
  const builtin = await buildBuiltinSkillZip(id);
  if (builtin) return zipResponse(id, builtin);

  return withRequestOwnerId(req, async (ownerId, responseHeaders) => {
    const skill = await findUserSkill(id, ownerId);
    if (!skill) return new Response('Not found', { status: 404, headers: responseHeaders });
    return zipResponse(
      id,
      await buildUserSkillZip({
        name: skill.name,
        title: skill.title,
        description: skill.description,
        content: skill.content,
      }),
      responseHeaders,
    );
  });
}
