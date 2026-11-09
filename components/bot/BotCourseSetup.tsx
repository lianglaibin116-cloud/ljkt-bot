'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, LoaderCircle, Mic2, Settings2, Square, Volume2 } from 'lucide-react';
import { getEnabledProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { playBrowserTTSPreview } from '@/lib/audio/browser-tts-preview';
import { resolveAgentVoiceOptions } from '@/lib/audio/agent-voice';
import type { TTSProviderId } from '@/lib/audio/types';
import { useAllVoiceProfiles } from '@/lib/audio/voxcpm-voices';
import { useSettingsStore } from '@/lib/store/settings';
import type { BotAction } from '@/lib/bot/contracts';

type PrepareCourseAction = Extract<BotAction, { type: 'prepare-course' }>;
export interface BotCourseSetupOptions {
  teacherAvatarPath: string;
  learnerAvatarPath: string;
  narratorVoice?: { providerId: string; voiceId: string; modelId?: string };
  userNickname: string;
  userBio: string;
  webSearch: boolean;
}

interface BotCourseSetupProps {
  action: PrepareCourseAction;
  onCancel: () => void;
  onOpenSettings: () => void;
  onStart: (action: PrepareCourseAction, options: BotCourseSetupOptions) => void;
}

export function BotCourseSetup({ action, onCancel, onOpenSettings, onStart }: BotCourseSetupProps) {
  const { profiles } = useAllVoiceProfiles();
  const ttsProvidersConfig = useSettingsStore((state) => state.ttsProvidersConfig);
  const globalTtsProviderId = useSettingsStore((state) => state.ttsProviderId);
  const globalTtsVoice = useSettingsStore((state) => state.ttsVoice);
  const webSearchDefault = useSettingsStore((state) => state.webSearchEnabled);
  const setWebSearchEnabled = useSettingsStore((state) => state.setWebSearchEnabled);

  const [title, setTitle] = useState(action.title);
  const [requirement, setRequirement] = useState(action.requirement);
  const [webSearch, setWebSearch] = useState(webSearchDefault);
  const teacherAvatarPath = '/avatars/teacher-2.png';
  const learnerAvatarPath = '/avatars/user.png';
  const [voiceKey, setVoiceKey] = useState('');
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [previewError, setPreviewError] = useState('');
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewCancelRef = useRef<(() => void) | null>(null);
  const previewRequestIdRef = useRef(0);
  const previewCacheRef = useRef(new Map<string, string>());

  const voiceOptions = useMemo(
    () =>
      getEnabledProvidersWithVoices(ttsProvidersConfig, profiles).flatMap((provider) =>
        provider.voices.map((voice) => {
          const cloneModelGroup =
            provider.providerId === 'qwen-tts'
              ? provider.modelGroups.find((group) =>
                  group.voices.some((groupVoice) => groupVoice.id === voice.id),
                )
              : undefined;
          return {
            key: `${provider.providerId}::${voice.id}`,
            providerId: provider.providerId,
            voiceId: voice.id,
            modelId: cloneModelGroup?.modelId,
            label: `${provider.providerName} · ${voice.name}`,
            language: voice.language,
          };
        }),
      ),
    [profiles, ttsProvidersConfig],
  );

  const selectedVoice = voiceOptions.find((voice) => voice.key === voiceKey);
  const currentVoice = voiceOptions.find(
    (voice) => voice.providerId === globalTtsProviderId && voice.voiceId === globalTtsVoice,
  );
  const currentVoiceLabel = currentVoice?.label;
  const previewVoice = useMemo(
    () =>
      selectedVoice ??
      currentVoice ??
      (globalTtsProviderId === 'browser-native-tts' && globalTtsVoice
        ? {
            providerId: globalTtsProviderId,
            voiceId: globalTtsVoice,
            modelId: undefined,
            label: '系统语音',
          }
        : undefined),
    [currentVoice, globalTtsProviderId, globalTtsVoice, selectedVoice],
  );

  const stopVoicePreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    previewCancelRef.current?.();
    previewCancelRef.current = null;
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.removeAttribute('src');
      previewAudioRef.current.load();
      previewAudioRef.current = null;
    }
    setPreviewState('idle');
  }, []);

  useEffect(
    () => () => {
      previewRequestIdRef.current += 1;
      previewCancelRef.current?.();
      previewAbortRef.current?.abort();
      previewAudioRef.current?.pause();
      previewAudioRef.current?.removeAttribute('src');
      previewAudioRef.current?.load();
    },
    [],
  );

  const handleVoicePreview = useCallback(async () => {
    if (!previewVoice) return;
    if (previewState !== 'idle') {
      stopVoicePreview();
      return;
    }

    stopVoicePreview();
    const requestId = previewRequestIdRef.current;
    setPreviewError('');
    const previewText = '你好，我是灵境课堂的授课老师。让我们一起开始今天的学习。';

    if (previewVoice.providerId === 'browser-native-tts') {
      const { promise, cancel } = playBrowserTTSPreview({
        text: previewText,
        voice: previewVoice.voiceId,
      });
      previewCancelRef.current = cancel;
      setPreviewState('playing');
      try {
        await promise;
        if (requestId === previewRequestIdRef.current) setPreviewState('idle');
      } catch (error) {
        if (requestId === previewRequestIdRef.current) {
          setPreviewState('idle');
          setPreviewError(
            error instanceof Error ? '系统语音试听失败：' + error.message : '系统语音试听失败。',
          );
        }
      } finally {
        if (requestId === previewRequestIdRef.current) previewCancelRef.current = null;
      }
      return;
    }

    const providerId = previewVoice.providerId as TTSProviderId;
    const providerConfig = ttsProvidersConfig[providerId];
    const modelId = previewVoice.modelId || providerConfig?.modelId;
    const cacheKey = providerId + '::' + (modelId || '') + '::' + previewVoice.voiceId;
    setPreviewState('loading');

    const playAudio = async (src: string) => {
      if (requestId !== previewRequestIdRef.current) return;
      const audio = new Audio(src);
      previewAudioRef.current = audio;
      audio.addEventListener(
        'ended',
        () => {
          if (requestId === previewRequestIdRef.current) {
            previewAudioRef.current = null;
            setPreviewState('idle');
          }
        },
        { once: true },
      );
      audio.addEventListener(
        'error',
        () => {
          if (requestId === previewRequestIdRef.current) {
            previewAudioRef.current = null;
            setPreviewState('idle');
            setPreviewError('试听音频无法播放，请检查浏览器或桌面端的音频输出。');
          }
        },
        { once: true },
      );
      setPreviewState('playing');
      await audio.play();
    };

    const cachedAudio = previewCacheRef.current.get(cacheKey);
    if (cachedAudio) {
      try {
        await playAudio(cachedAudio);
      } catch {
        if (requestId === previewRequestIdRef.current) {
          setPreviewState('idle');
          setPreviewError('试听音频无法播放，请检查浏览器或桌面端的音频输出。');
        }
      }
      return;
    }

    const controller = new AbortController();
    previewAbortRef.current = controller;
    try {
      const providerOptions = await resolveAgentVoiceOptions(undefined, {
        providerId,
        providerConfig: { ...providerConfig, modelId },
        voiceId: previewVoice.voiceId,
        language: 'zh-CN',
      });
      const response = await fetch('/api/generate/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: previewText,
          audioId: 'bot-course-voice-preview',
          ttsProviderId: providerId,
          ttsModelId: modelId,
          ttsVoice: previewVoice.voiceId,
          ttsSpeed: 1,
          ttsApiKey: providerConfig?.apiKey,
          ttsBaseUrl: providerConfig?.baseUrl || providerConfig?.customDefaultBaseUrl,
          ttsProviderOptions: providerOptions,
        }),
        signal: controller.signal,
      });
      const result = (await response.json().catch(() => ({}))) as {
        base64?: string;
        format?: string;
        message?: string;
        error?: string | { message?: string };
      };
      if (!response.ok) {
        const errorMessage =
          typeof result.error === 'string' ? result.error : result.error?.message || result.message;
        throw new Error(errorMessage || '语音服务暂时无法试听，请检查模型与设置。');
      }
      if (!result.base64) throw new Error('语音服务没有返回试听音频。');

      const audioSrc = 'data:audio/' + (result.format || 'mp3') + ';base64,' + result.base64;
      if (requestId !== previewRequestIdRef.current) return;
      previewCacheRef.current.set(cacheKey, audioSrc);
      if (previewCacheRef.current.size > 8) {
        const oldestKey = previewCacheRef.current.keys().next().value;
        if (oldestKey) previewCacheRef.current.delete(oldestKey);
      }
      await playAudio(audioSrc);
    } catch (error) {
      if (requestId === previewRequestIdRef.current) {
        setPreviewState('idle');
        if (error instanceof Error && error.name === 'AbortError') return;
        setPreviewError(
          error instanceof Error ? error.message : '语音试听失败，请检查声音服务配置。',
        );
      }
    } finally {
      if (requestId === previewRequestIdRef.current) previewAbortRef.current = null;
    }
  }, [previewState, previewVoice, stopVoicePreview, ttsProvidersConfig]);

  const start = () => {
    if (!title.trim() || !requirement.trim()) return;
    setWebSearchEnabled(webSearch);
    onStart(
      {
        ...action,
        title: title.trim(),
        requirement: requirement.trim(),
        interactive: false,
        teacherDemo: false,
      },
      {
        teacherAvatarPath,
        learnerAvatarPath,
        narratorVoice: selectedVoice
          ? {
              providerId: selectedVoice.providerId,
              voiceId: selectedVoice.voiceId,
              ...(selectedVoice.modelId ? { modelId: selectedVoice.modelId } : {}),
            }
          : undefined,
        userNickname: '',
        userBio: '',
        webSearch,
      },
    );
  };

  return (
    <div className="ljbot-create-workspace">
      <div className="ljbot-create-heading">
        <div className="ljbot-create-icon">
          <BookOpen size={19} />
        </div>
        <div>
          <div className="ljbot-kicker">BOT 课件工作台</div>
          <h2>制作前设置</h2>
          <p>确认教学要求与教师声音，再进入大纲审阅。</p>
        </div>
      </div>

      <label className="ljbot-create-field">
        <span>课件标题</span>
        <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="ljbot-create-field">
        <span>教学主题与要求</span>
        <textarea
          value={requirement}
          rows={5}
          maxLength={20000}
          onChange={(event) => setRequirement(event.target.value)}
          placeholder="补充学段、课时、教学目标、内容重点或材料使用要求…"
        />
      </label>

      <div className="ljbot-create-section">
        <div className="ljbot-create-section-title">
          <Mic2 size={16} /> 教师声音
        </div>
        <div className="ljbot-voice-row">
          <select
            value={voiceKey}
            onChange={(event) => {
              stopVoicePreview();
              setVoiceKey(event.target.value);
            }}
          >
            <option value="">
              跟随应用当前声音{currentVoiceLabel ? ` · ${currentVoiceLabel}` : ''}
            </option>
            {voiceOptions.map((voice) => (
              <option key={voice.key} value={voice.key}>
                {voice.label}
                {voice.language ? ` · ${voice.language}` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ljbot-voice-preview"
            onClick={() => void handleVoicePreview()}
            disabled={!previewVoice}
            aria-label={
              previewState === 'idle'
                ? '试听教师声音：' + (previewVoice?.label || '当前声音')
                : previewState === 'loading'
                  ? '取消声音试听'
                  : '停止声音试听'
            }
            title={
              previewState === 'idle'
                ? '试听教师声音：' + (previewVoice?.label || '当前声音')
                : '停止试听'
            }
          >
            {previewState === 'loading' ? (
              <LoaderCircle size={14} className="ljbot-voice-preview-spinner" />
            ) : previewState === 'playing' ? (
              <Square size={12} />
            ) : (
              <Volume2 size={15} />
            )}
            {previewState === 'loading'
              ? '取消试听'
              : previewState === 'playing'
                ? '停止试听'
                : '试听音色'}
          </button>
          {!voiceOptions.length && (
            <button type="button" onClick={onOpenSettings}>
              <Settings2 size={14} /> 配置声音
            </button>
          )}
        </div>
        {previewState === 'loading' && (
          <span className="ljbot-create-caption" role="status" aria-live="polite">
            正在生成试听音频…
          </span>
        )}
        {previewError && (
          <span className="ljbot-voice-preview-error" role="alert">
            {previewError}
          </span>
        )}
        <span className="ljbot-create-caption">
          声音服务和旁白开关由“模型与设置”管理；这里选择的教师音色只应用于本课程。试听会调用所选服务生成一段短音频，同一音色在本次打开期间会缓存试听结果。
        </span>
      </div>

      <div className="ljbot-create-toggles" role="group" aria-label="生成选项">
        <label>
          <input
            type="checkbox"
            checked={webSearch}
            onChange={(event) => setWebSearch(event.currentTarget.checked)}
          />{' '}
          生成时使用网络搜索
        </label>
      </div>

      <div className="ljbot-create-actions">
        <button type="button" className="ljbot-create-secondary" onClick={onCancel}>
          返回对话
        </button>
        <button
          type="button"
          className="ljbot-create-primary"
          disabled={!title.trim() || !requirement.trim()}
          onClick={start}
        >
          开始整理大纲 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
