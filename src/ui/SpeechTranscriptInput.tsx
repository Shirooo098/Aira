import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { createSpeechSessionController, type SpeechSessionState } from '../speech/speech-session.ts';
import { createWhisperAdapter } from '../speech/whisper-adapter.ts';
import { SpeechTranscriptControls } from './SpeechTranscriptControls.tsx';

export interface SpeechTranscriptInputProps {
  onReviewedTranscript?: (text: string) => void;
  onTranscriptInvalidated?: () => void;
  reviewLabel?: string;
  title?: string;
  description?: string;
  compact?: boolean;
}

function errorMessage(state: SpeechSessionState): string | null {
  const error = state.error;
  if (!error) return null;

  const code = error.code.toLowerCase();
  if (code.includes('permission') || code.includes('denied')) {
    return 'Hindi pinahintulutan ang mikropono. Maaari kang mag-type, o payagan ang mikropono sa Settings para gumamit ng boses.';
  }
  if (code.includes('empty')) {
    return 'Walang malinaw na narinig. Magsalita nang malapit sa mikropono at subukan muli.';
  }
  if (code.includes('timeout')) {
    return 'Masyadong matagal ang pagproseso ng boses. Subukan muli.';
  }
  if (code.includes('native') || code.includes('unavailable') || code.includes('module')) {
    return 'Hindi available ang offline na boses sa build na ito. Buksan ang Aira development build para sa speech; maaari pa ring mag-type.';
  }

  return error.message;
}

export function SpeechTranscriptInput({
  onReviewedTranscript,
  onTranscriptInvalidated,
  reviewLabel,
  title,
  description,
  compact = false,
}: SpeechTranscriptInputProps = {}): React.JSX.Element {
  const adapter = useMemo(() => createWhisperAdapter(), []);
  const onReviewedTranscriptRef = useRef(onReviewedTranscript);
  const onTranscriptInvalidatedRef = useRef(onTranscriptInvalidated);
  onReviewedTranscriptRef.current = onReviewedTranscript;
  onTranscriptInvalidatedRef.current = onTranscriptInvalidated;

  const invalidateTranscript = () => {
    try {
      onTranscriptInvalidatedRef.current?.();
    } catch {
      // A consumer callback must not interrupt capture cleanup or startup.
    }
  };

  const session = useMemo(() => createSpeechSessionController(adapter, {
    onReviewedTranscript: (text) => onReviewedTranscriptRef.current?.(text),
  }), [adapter]);

  const [state, setState] = useState<SpeechSessionState>(() => session.getState());
  const [reviewedDraft, setReviewedDraft] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState(false);
  const holdActive = useRef(false);
  const startPending = useRef(false);
  const holdAttempt = useRef(0);

  useEffect(() => session.subscribe(setState), [session]);

  useEffect(() => () => {
    holdActive.current = false;
    holdAttempt.current++;
    void session.dispose();
  }, [session]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (appState) => {
      if (appState === 'background') {
        holdActive.current = false;
        startPending.current = false;
        holdAttempt.current++;
        setReviewedDraft(null);
        invalidateTranscript();
        void session.cancelForBackground();
      }
    });
    return () => subscription.remove();
  }, [session]);

  const prepareSpeech = () => {
    setSettingsError(false);
    void session.initialize();
  };

  const handleHoldStart = () => {
    if (!session.getState().prepared || session.getState().status !== 'ready') return;

    setReviewedDraft(null);
    invalidateTranscript();
    holdActive.current = true;
    startPending.current = true;
    const attempt = ++holdAttempt.current;
    void session.start().finally(() => {
      if (attempt === holdAttempt.current) startPending.current = false;
    });
  };

  const handleHoldEnd = () => {
    if (!holdActive.current) return;
    holdActive.current = false;

    const current = session.getState();
    if (current.status === 'starting' || current.status === 'preparing') {
      startPending.current = false;
      holdAttempt.current++;
      void session.cancel();
      return;
    }
    if (current.status === 'recording') {
      startPending.current = false;
      holdAttempt.current++;
      void session.stop();
      return;
    }
    if (startPending.current) {
      startPending.current = false;
      holdAttempt.current++;
      void session.cancel();
    }
  };

  const toggleAccessibleCapture = () => {
    const current = session.getState();
    if (current.status === 'recording') {
      void session.stop();
    } else if (current.status === 'starting' || current.status === 'preparing') {
      holdActive.current = false;
      startPending.current = false;
      holdAttempt.current++;
      void session.cancel();
    } else if (current.status === 'ready' && current.prepared) {
      setReviewedDraft(null);
      invalidateTranscript();
      void session.start();
    }
  };

  const handleCancel = () => {
    holdActive.current = false;
    startPending.current = false;
    holdAttempt.current++;
    setReviewedDraft(null);
    invalidateTranscript();
    void session.cancel();
  };

  const handleRetry = () => {
    holdActive.current = false;
    startPending.current = false;
    holdAttempt.current++;
    setReviewedDraft(null);
    invalidateTranscript();
    void session.retry();
  };

  const handleDiscard = () => {
    holdActive.current = false;
    startPending.current = false;
    holdAttempt.current++;
    setReviewedDraft(null);
    invalidateTranscript();
    void session.cancel();
  };

  const handleReview = () => {
    const draft = session.review();
    setReviewedDraft(draft);
  };

  const handleEditDraft = (text: string) => {
    setReviewedDraft(null);
    invalidateTranscript();
    session.edit(text);
  };

  const handleOpenSettings = () => {
    setSettingsError(false);
    void Linking.openSettings().catch(() => setSettingsError(true));
  };

  const busy = state.status === 'preparing' || state.status === 'starting' || state.status === 'transcribing';
  const errorText = errorMessage(state);
  const permissionDenied = Boolean(state.error && /permission|denied/i.test(state.error.code));
  const holdEnabled = state.prepared && (state.status === 'ready' || holdActive.current);
  const accessibleCaptureLabel = state.status === 'recording'
    ? 'Itigil ang pag-record'
    : state.status === 'starting' || state.status === 'preparing'
      ? 'Kanselahin ang pagsisimula ng pag-record'
      : 'Magsimula ng pag-record';
  const statusText = !state.prepared
    ? state.status === 'preparing'
      ? 'Inihahanda ang offline na pagkilala sa boses...'
      : 'Ihanda muna ang boses bago magsalita. Maaari ka ring mag-type.'
    : state.status === 'starting'
      ? 'Inihahanda ang mikropono...'
      : state.status === 'recording'
        ? 'Nakikinig. Hanggang 15 segundo ang bawat pag-record.'
        : state.status === 'transcribing'
          ? 'Ginagawang teksto ang boses...'
          : state.status === 'review'
            ? 'Suriin at itama ang transcript bago markahang nasuri.'
            : 'Handa nang makinig offline.';

  return (
    <SpeechTranscriptControls
      compact={compact}
      state={state}
      busy={busy}
      holdEnabled={holdEnabled}
      errorText={errorText}
      permissionDenied={permissionDenied}
      settingsError={settingsError}
      statusText={statusText}
      accessibleCaptureLabel={accessibleCaptureLabel}
      reviewedDraft={reviewedDraft}
      reviewLabel={reviewLabel}
      title={title}
      description={description}
      onPrepare={prepareSpeech}
      onHoldStart={handleHoldStart}
      onHoldEnd={handleHoldEnd}
      onToggleAccessibleCapture={toggleAccessibleCapture}
      onCancel={handleCancel}
      onRetry={handleRetry}
      onReview={handleReview}
      onDiscard={handleDiscard}
      onEditDraft={handleEditDraft}
      onOpenSettings={handleOpenSettings}
    />
  );
}
