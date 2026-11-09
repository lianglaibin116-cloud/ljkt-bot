import type { QuizQuestion } from '@openmaic/dsl';

export interface OfflineMedia {
  kind: 'video' | 'audio';
  src: string;
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}

export interface OfflinePage {
  id: string;
  title: string;
  kind: 'slide' | 'interactive' | 'quiz';
  image?: string;
  html?: string;
  ratio?: number;
  media?: OfflineMedia[];
  questions?: QuizQuestion[];
  narration: { text: string; src?: string }[];
  boards?: { image: string; ratio: number }[];
}

export interface OfflineLesson {
  title: string;
  pages: OfflinePage[];
}
