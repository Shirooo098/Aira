import { AudioModule, requestRecordingPermissionsAsync } from 'expo-audio';
import { NativeModules, Platform } from 'react-native';
import type { WhisperContext } from 'whisper.rn/index';
import type { SpeechAdapter, SpeechCapture } from './speech-session.ts';
import { hasAudiblePcm16, joinPcm16 } from './pcm.ts';
import { disposeAudioPlayers } from '../audio/cue-player.ts';

let microphoneInUse = false;
export function isSpeechCaptureActive(): boolean { return microphoneInUse; }

function speechError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function createWhisperAdapter(): SpeechAdapter {
  let context: WhisperContext | null = null;
  let activeCapture: SpeechCapture | null = null;
  let disposed = false;

  return {
    async prepare() {
      if (disposed) throw speechError('disposed', 'Speech session closed.');
      if (context) return;
      // Import only after checking native availability: Expo Go keeps typed input usable.
      if (Platform.OS !== 'android' || !NativeModules.RNWhisper) {
        throw speechError('native_unavailable', 'Kailangan ang Android app na may offline na boses. Maaari pa ring mag-type.');
      }
      const { initWhisper } = await import('whisper.rn/index');
      // Read directly from APK assets, in development and release. Never use HTTP/Metro.
      context = await initWhisper({ filePath: 'models/whisper.bin', isBundleAsset: true, useGpu: false, useCoreMLIos: false });
    },

    async start() {
      if (disposed || !context) throw speechError('not_ready', 'Hindi pa handa ang boses.');
      if (activeCapture) throw speechError('busy', 'May kasalukuyang pag-record.');
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw speechError('permission_denied', 'Kailangan ang pahintulot sa mikropono.');
      if (microphoneInUse) throw speechError('busy', 'May kasalukuyang pag-record.');
      disposeAudioPlayers();

      const stream = new AudioModule.AudioStream({ sampleRate: 16000, channels: 1, encoding: 'int16' });
      let chunks: ArrayBuffer[] = [];
      let samples = 0;
      let capturing = true;
      let captureFailure: Error | null = null;
      let task: ReturnType<WhisperContext['transcribeData']> | null = null;
      let stopPromise: Promise<string> | null = null;
      let cancelPromise: Promise<void> | null = null;
      let cancelled = false;
      let cleaned = false;
      const subscription = stream.addListener('audioStreamBuffer', (buffer) => {
        if (!capturing) return;
        if (buffer.sampleRate !== 16000 || buffer.channels !== 1 || buffer.data.byteLength % 2 !== 0) {
          captureFailure = speechError('unsupported_audio', 'Hindi tugma ang format ng mikropono.');
          return;
        }
        const availableBytes = Math.max(0, 16000 * 15 * 2 - samples * 2);
        const bytes = Math.min(buffer.data.byteLength, availableBytes);
        if (bytes > 0) {
          chunks.push(buffer.data.slice(0, bytes));
          samples += bytes / 2;
        }
      });
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        capturing = false;
        try { subscription.remove(); }
        finally {
          try { stream.stop(); }
          finally {
            try { stream.release(); }
            finally { microphoneInUse = false; }
          }
        }
      };
      const capture: SpeechCapture = {
        stop() {
          if (stopPromise) return stopPromise;
          stopPromise = (async () => {
            try {
              cleanup();
              if (cancelled) return '';
              if (captureFailure) throw captureFailure;
              if (!samples) throw speechError('empty_audio', 'Walang narinig na boses.');
              const pcm = joinPcm16(chunks);
              chunks = [];
              if (!hasAudiblePcm16(pcm)) throw speechError('empty_audio', 'Walang malinaw na boses.');
              task = context!.transcribeData(pcm, { language: 'tl', translate: false, maxThreads: 4 });
              const result = await task.promise;
              if (cancelled || result.isAborted) return '';
              return result.result.trim();
            } finally {
              chunks = [];
              task = null;
              if (activeCapture === capture) activeCapture = null;
            }
          })();
          return stopPromise;
        },
        cancel() {
          if (cancelPromise) return cancelPromise;
          cancelled = true;
          cancelPromise = (async () => {
            try {
              cleanup();
              if (task) await task.stop();
              await stopPromise?.catch(() => undefined);
            } finally {
              chunks = [];
              if (activeCapture === capture) activeCapture = null;
            }
          })();
          return cancelPromise;
        },
      };
      activeCapture = capture;
      try {
        microphoneInUse = true;
        await stream.start();
        if (stream.sampleRate !== 16000 || stream.channels !== 1) {
          throw speechError('unsupported_audio', 'Hindi tugma ang format ng mikropono.');
        }
        return capture;
      } catch (error) {
        await capture.cancel();
        throw error;
      }
    },

    async dispose() {
      disposed = true;
      await activeCapture?.cancel();
      const previous = context;
      context = null;
      await previous?.release();
    },
  };
}
