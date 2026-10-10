import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { SpeechSessionState } from '../speech/speech-session.ts';
import { AppIcon } from './AppIcon.tsx';
import { colors } from './theme.ts';
import { speechTranscriptStyles as styles } from './speech-transcript-styles.ts';

export interface SpeechTranscriptControlsProps {
  compact?: boolean;
  state: SpeechSessionState;
  busy: boolean;
  holdEnabled: boolean;
  errorText: string | null;
  permissionDenied: boolean;
  settingsError: boolean;
  statusText: string;
  accessibleCaptureLabel: string;
  reviewedDraft: string | null;
  reviewLabel?: string;
  title?: string;
  description?: string;
  onPrepare: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  onToggleAccessibleCapture: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onReview: () => void;
  onDiscard: () => void;
  onEditDraft: (text: string) => void;
  onOpenSettings: () => void;
}

export function SpeechTranscriptControls({
  compact = false,
  state,
  busy,
  holdEnabled,
  errorText,
  permissionDenied,
  settingsError,
  statusText,
  accessibleCaptureLabel,
  reviewedDraft,
  reviewLabel,
  title,
  description,
  onPrepare,
  onHoldStart,
  onHoldEnd,
  onToggleAccessibleCapture,
  onCancel,
  onRetry,
  onReview,
  onDiscard,
  onEditDraft,
  onOpenSettings,
}: SpeechTranscriptControlsProps): React.JSX.Element {
  const showStatus = !compact || busy || state.status === 'recording';

  return (
    <View style={compact ? styles.compactContainer : styles.container}>
      {!compact && (
        <>
          <Text style={styles.title}>{title ?? 'Gamitin ang boses'}</Text>
          <Text style={styles.description}>
            {description ?? 'Magsalita sa Filipino o Taglish, hal. “Magkano ang Coke?” Suriin muna ang transcript bago hanapin sa catalog; walang awtomatikong sine-save.'}
          </Text>
        </>
      )}

      {/* Main Trigger / Hold Control */}
      {!state.prepared ? (
        <Pressable
          style={[compact ? styles.compactSpeechButton : styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={onPrepare}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={state.status === 'preparing' ? 'Inihahanda ang boses' : 'Ihanda ang boses'}
        >
          {compact && <AppIcon name="mic" size={22} color={colors.primary} />}
          <Text style={compact ? styles.compactSpeechButtonText : styles.primaryButtonText}>
            {state.status === 'preparing'
              ? 'Inihahanda...'
              : state.status === 'error'
                ? 'Subukang Ihanda Muli'
                : 'Ihanda ang boses'}
          </Text>
        </Pressable>
      ) : (
        <>
          {(state.status === 'ready' || state.status === 'starting' || state.status === 'recording') && (
            <Pressable
              accessible={false}
              style={[compact ? styles.compactSpeechButton : styles.holdButton, !holdEnabled && styles.buttonDisabled]}
              onPressIn={onHoldStart}
              onPressOut={onHoldEnd}
              disabled={!holdEnabled}
            >
              <AppIcon name="mic" size={compact ? 22 : 24} color={colors.primary} />
              <Text style={compact ? styles.compactSpeechButtonText : styles.holdButtonText}>
                {state.status === 'recording'
                  ? (compact ? 'Nakikinig — pakawalan' : 'Nakikinig — pakawalan upang tapusin')
                  : state.status === 'starting'
                    ? 'Inihahanda ang mikropono...'
                    : (compact ? 'Magsalita — hawakan' : 'Pindutin at hawakan para magsalita')}
              </Text>
            </Pressable>
          )}

          {(state.status === 'ready' || state.status === 'starting' || state.status === 'recording') && (
            <Pressable
              style={compact ? styles.accessibleButton : styles.secondaryButton}
              onPress={onToggleAccessibleCapture}
              accessibilityRole="button"
              accessibilityLabel={accessibleCaptureLabel}
            >
              <Text style={compact ? styles.accessibleButtonText : styles.secondaryButtonText}>
                {accessibleCaptureLabel}
              </Text>
            </Pressable>
          )}

          {state.status === 'starting' || state.status === 'recording' || state.status === 'transcribing' ? (
            <Pressable
              style={styles.cancelButton}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Kanselahin at itapon ang kasalukuyang pag-record"
            >
              <Text style={styles.cancelButtonText}>Kanselahin</Text>
            </Pressable>
          ) : null}

          {(state.status === 'error' || state.status === 'review') && (
            <Pressable
              style={styles.secondaryButton}
              onPress={onRetry}
              accessibilityRole="button"
              accessibilityLabel="Magsalita muli"
            >
              <Text style={styles.secondaryButtonText}>Magsalita Muli</Text>
            </Pressable>
          )}
        </>
      )}

      {/* Status & Error Feedbacks */}
      {showStatus && (
        <View style={styles.statusRow}>
          {busy && <ActivityIndicator size="small" color={colors.primary} />}
          <Text style={styles.statusText} accessibilityLiveRegion="polite">
            {statusText}
          </Text>
        </View>
      )}

      {errorText && (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>{errorText}</Text>
          {permissionDenied && (
            <Pressable
              style={styles.settingsButton}
              onPress={onOpenSettings}
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

      {state.status === 'recording' && state.recognizedTranscript.length > 0 && (
        <Text style={styles.partialTranscript} accessibilityLiveRegion="polite">
          Pansamantalang pagkilala: {state.recognizedTranscript}
        </Text>
      )}

      {/* Transcript Review Flow */}
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
            onChangeText={onEditDraft}
            placeholder="Dito lalabas ang transcript"
            placeholderTextColor={colors.muted}
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
              style={compact ? styles.compactSpeechButton : styles.primaryButton}
              onPress={onReview}
              accessibilityRole="button"
              accessibilityLabel={reviewLabel ?? 'Markahang nasuri ang transcript'}
            >
              <Text style={compact ? styles.compactSpeechButtonText : styles.primaryButtonText}>
                {reviewLabel ?? 'Markahang Nasuri'}
              </Text>
            </Pressable>
          )}

          <Pressable
            style={styles.discardButton}
            onPress={onDiscard}
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
