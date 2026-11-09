import type { GenerationSessionState } from '@/app/generation-preview/types';
import type { BotAction } from './contracts';
import type { SessionDocumentSource } from '@/lib/types/generation';

/** Reuse the complete teacher generation pipeline, including outline review. */
export function buildBotCourseSession(
  action: Extract<BotAction, { type: 'prepare-course' }>,
  options: {
    sessionId: string;
    webSearch: boolean;
    teacherAvatarPath?: string;
    learnerAvatarPath?: string;
    narratorVoice?: GenerationSessionState['narratorVoice'];
    userNickname?: string;
    userBio?: string;
    documents?: SessionDocumentSource[];
    pdfProviderId?: string;
    pdfProviderConfig?: GenerationSessionState['pdfProviderConfig'];
  },
): GenerationSessionState {
  return {
    sessionId: options.sessionId,
    requirements: {
      requirement: action.requirement,
      interactiveMode: action.interactive,
      teacherDemoMode: action.teacherDemo,
      webSearch: options.webSearch,
      ...(options.userNickname ? { userNickname: options.userNickname } : {}),
      ...(options.userBio ? { userBio: options.userBio } : {}),
    },
    teacherAvatarPath: options.teacherAvatarPath,
    learnerAvatarPath: options.learnerAvatarPath,
    narratorVoice: options.narratorVoice,
    pdfText: '',
    pdfImages: [],
    imageStorageIds: [],
    documentSources: options.documents,
    pdfProviderId: options.pdfProviderId,
    pdfProviderConfig: options.pdfProviderConfig,
    sceneOutlines: null,
    requireOutlineConfirmation: true,
    currentStep: 'generating',
  };
}
