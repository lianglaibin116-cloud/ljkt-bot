import { TTS_PROVIDERS } from '@/lib/audio/constants';
import type { BuiltInTTSProviderId } from '@/lib/audio/types';

export type VoiceGender = 'male' | 'female';

type VoiceCatalog = readonly {
  providerId: string;
  voices: readonly { id: string; gender?: 'male' | 'female' | 'neutral' }[];
}[];

const DEFAULT_AGENT_AVATAR_PAIRS: Record<string, Record<VoiceGender, string>> = {
  'default-1': { female: '/avatars/teacher.png', male: '/avatars/assist.png' },
  'default-2': { female: '/avatars/clown.png', male: '/avatars/curious.png' },
  'default-3': { female: '/avatars/note-taker.png', male: '/avatars/thinker.png' },
  'default-4': { female: '/avatars/teacher.png', male: '/avatars/assist.png' },
  'default-5': { female: '/avatars/clown.png', male: '/avatars/curious.png' },
  'default-6': { female: '/avatars/note-taker.png', male: '/avatars/thinker.png' },
};

/** Resolve the declared gender for a voice, including dynamic picker catalogs. */
export function getTTSVoiceGender(
  providerId: string,
  voiceId: string,
  catalog?: VoiceCatalog,
  providerConfig?: {
    customVoices?: readonly { id: string; gender?: 'male' | 'female' | 'neutral' }[];
  },
): VoiceGender | undefined {
  const catalogVoice = catalog
    ?.find((provider) => provider.providerId === providerId)
    ?.voices.find((voice) => voice.id === voiceId);
  if (catalogVoice?.gender === 'male' || catalogVoice?.gender === 'female') {
    return catalogVoice.gender;
  }

  const provider = TTS_PROVIDERS[providerId as BuiltInTTSProviderId];
  const voice = provider?.voices.find((item) => item.id === voiceId);
  if (voice?.gender === 'male' || voice?.gender === 'female') return voice.gender;

  const customVoice = providerConfig?.customVoices?.find((item) => item.id === voiceId);
  return customVoice?.gender === 'male' || customVoice?.gender === 'female'
    ? customVoice.gender
    : undefined;
}

/** Keep preset identities while matching their portraits to the selected voice. */
export function getAgentAvatarForVoice(
  agent: { id: string; avatar: string },
  gender?: VoiceGender,
): string {
  if (!gender) return agent.avatar;
  return DEFAULT_AGENT_AVATAR_PAIRS[agent.id]?.[gender] ?? agent.avatar;
}
