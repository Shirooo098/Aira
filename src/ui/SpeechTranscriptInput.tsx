import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { createSpeechSessionController, type SpeechSessionState } from '../speech/speech-session.ts';
import { createWhisperAdapter } from '../speech/whisper-adapter.ts';
import { speechTranscriptStyles as styles } from './speech-transcript-styles.ts';

interface SpeechTranscriptInputProps {
  onReviewedTranscript?: (text: string) => void;
  onTranscriptInvalidated?: () => void;
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
}: SpeechTranscriptInputProps): React.JSX.Element {
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
    <View style={styles.container}>
      <Text style={styles.title}>Gamitin ang boses</Text>
      <Text style={styles.description}>
        Magsalita sa Filipino o Taglish, hal. “Magkano ang Coke?” Suriin muna ang transcript bago hanapin sa catalog; walang awtomatikong sine-save.
      </Text>

      <View style={styles.statusRow}>
        {busy && <ActivityIndicator size="small" color="#0284c7" />}
        <Text style={styles.statusText} accessibilityLiveRegion="polite">
          {statusText}
        </Text>
      </View>

      {errorText && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{errorText}</Text>
          {permissionDenied && (
            <Pressable
              style={styles.settingsButton}
              onPress={handleOpenSettings}
              accessibilityRole="button"
              accessibilityLabel="Buksan ang Settings para payagan ang mikropono"
            >
              <Text style={styles.secondaryButtonText}>Buksan ang Settings</Text>
            </Pressable>
          )}
          {settingsError && (
            <Text style={styles.settingsError}>Hindi mabuksan ang Settings. Maaari mo itong buksan mula sa Android Settings.</Text>
          )}
        </View>
      )}

      {!state.prepared ? (
        <Pressable
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={prepareSpeech}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={state.status === 'preparing' ? 'Inihahanda ang boses' : 'Ihanda ang offline na pagkilala sa boses'}
        >
          <Text style={styles.primaryButtonText}>
            {state.status === 'preparing' ? 'Inihahanda...' : state.status === 'error' ? 'Subukang Ihanda Muli' : 'Ihanda ang boses'}
          </Text>
        </Pressable>
      ) : (
        <>
          {(state.status === 'ready' || state.status === 'starting' || state.status === 'recording') && (
            <Pressable
              accessible={false}
              style={[styles.holdButton, !holdEnabled && styles.buttonDisabled]}
              onPressIn={handleHoldStart}
              onPressOut={handleHoldEnd}
              disabled={!holdEnabled}
            >
              <Text style={styles.microphoneIcon} aria-hidden>
                🎙️
              </Text>
              <Text style={styles.holdButtonText}>
                {state.status === 'recording'
                  ? 'Nakikinig — pakawalan upang tapusin'
                  : state.status === 'starting'
                    ? 'Inihahanda ang mikropono...'
                    : 'Pindutin at hawakan para magsalita'}
              </Text>
            </Pressable>
          )}

          {(state.status === 'ready' || state.status === 'starting' || state.status === 'recording') && (
            <Pressable
              style={styles.secondaryButton}
              onPress={toggleAccessibleCapture}
              accessibilityRole="button"
              accessibilityLabel={accessibleCaptureLabel}
            >
              <Text style={styles.secondaryButtonText}>{accessibleCaptureLabel}</Text>
            </Pressable>
          )}

          {state.status === 'starting' || state.status === 'recording' || state.status === 'transcribing' ? (
            <Pressable
              style={styles.cancelButton}
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="Kanselahin at itapon ang kasalukuyang pag-record"
            >
              <Text style={styles.cancelButtonText}>Kanselahin</Text>
            </Pressable>
          ) : null}

          {(state.status === 'error' || state.status === 'review') && (
            <Pressable
              style={styles.secondaryButton}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Magsalita muli"
            >
              <Text style={styles.secondaryButtonText}>Magsalita Muli</Text>
            </Pressable>
          )}
        </>
      )}

      {state.status === 'recording' && state.recognizedTranscript.length > 0 && (
        <Text style={styles.partialTranscript} accessibilityLiveRegion="polite">
          Pansamantalang pagkilala: {state.recognizedTranscript}
        </Text>
      )}

      {state.status === 'review' && state.recognizedTranscript.length > 0 && (
        <View style={styles.transcriptSection}>
          <Text style={styles.transcriptLabel}>Unang pagkilala</Text>
          <Text style={styles.recognizedText} accessibilityLabel={`Unang nakilalang transcript: ${state.recognizedTranscript}`}>
            {state.recognizedTranscript}
          </Text>

          <Text style={styles.transcriptLabel}>Iwasto kung kailangan</Text>
          <TextInput
            style={styles.transcriptInput}
            value={state.draft}
            onChangeText={(text) => {
              setReviewedDraft(null);
              invalidateTranscript();
              session.edit(text);
            }}
            placeholder="Dito lalabas ang transcript"
            placeholderTextColor="#94a3b8"
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            accessibilityLabel="I-edit ang transcript"
          />

          {reviewedDraft !== null && reviewedDraft === state.draft ? (
            <Text style={styles.reviewedNotice} accessibilityLiveRegion="polite">
              Nasuri ang transcript. Maaari mo pa itong itama o itapon.
            </Text>
          ) : (
            <Pressable
              style={styles.primaryButton}
              onPress={handleReview}
              accessibilityRole="button"
              accessibilityLabel="Markahang nasuri ang transcript"
            >
              <Text style={styles.primaryButtonText}>Markahang Nasuri</Text>
            </Pressable>
          )}

          <Pressable
            style={styles.discardButton}
            onPress={handleDiscard}
            accessibilityRole="button"
            accessibilityLabel="Itapon ang transcript"
          >
            <Text style={styles.discardButtonText}>Itapon ang transcript</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
