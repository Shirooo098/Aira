import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as SQLite from 'expo-sqlite';
import type { DatabaseSession } from './src/db/database.ts';
import { ExpoSqliteAdapter } from './src/db/expo-sqlite-adapter.ts';
import { runMigrations } from './src/db/migrations.ts';
import { playModeCue, disposeAudioPlayers } from './src/audio/cue-player.ts';
import { isSpeechCaptureActive } from './src/speech/whisper-adapter.ts';
import type { AppMode } from './src/types.ts';
import { ModeSelector } from './src/ui/ModeSelector.tsx';
import { AskPriceView } from './src/ui/AskPriceView.tsx';
import { SellView } from './src/ui/SellView.tsx';
import { ManageProductsView } from './src/ui/ManageProductsView.tsx';

export default function App(): React.JSX.Element {
  const [db, setDb] = useState<DatabaseSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [activeMode, setActiveMode] = useState<AppMode>('ask-price');
  const [audioWarning, setAudioWarning] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let connection: SQLite.SQLiteDatabase | undefined;
    setInitializing(true);
    setInitError(null);
    const initialization = (async () => {
      try {
        connection = await SQLite.openDatabaseAsync('aira.db', { useNewConnection: true });
        const adapter = new ExpoSqliteAdapter(connection);
        await runMigrations(adapter);
        if (active) setDb(adapter);
      } catch (err) {
        if (__DEV__) console.error('[Aira App] Error initializing database:', err);
        if (active) setInitError('Nagkaroon ng aberya sa pagsisimula ng database ng tindahan.');
      } finally {
        if (active) setInitializing(false);
      }
    })();
    return () => {
      active = false;
      // Let an in-flight migration finish before closing its connection.
      void initialization.then(() => connection?.closeAsync()).catch((error) => {
        console.error('[Aira App] Database cleanup failed:', error);
      });
      disposeAudioPlayers();
    };
  }, [attempt]);

  const handleSelectMode = async (mode: AppMode) => {
    setActiveMode(mode);
    // The old view cancels its capture on unmount; avoid recording the next mode cue.
    if (isSpeechCaptureActive()) return;
    const cueRes = await playModeCue(mode);
    if (!cueRes.ok && cueRes.error) {
      setAudioWarning(`Babala sa audio: ${cueRes.error}`);
    } else {
      setAudioWarning(null);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

        {/* Top App Header */}
        <View style={styles.appHeader}>
          <View>
            <Text style={styles.appName}>Aira</Text>
            <Text style={styles.appDescriptor}>Offline Tindahan Assistant</Text>
          </View>
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        </View>

        {/* Nonblocking Audio Warning Banner */}
        {audioWarning && (
          <View style={styles.warningBanner} accessibilityRole="alert">
            <Text style={styles.warningText}>{audioWarning}</Text>
            <TouchableOpacity
              onPress={() => setAudioWarning(null)}
              accessibilityLabel="Isara ang babala"
              accessibilityRole="button"
              style={styles.warningDismiss}
            >
              <Text style={styles.warningDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Database Initialization Loading State */}
        {initializing && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#0284c7" />
            <Text style={styles.loadingText}>Inihahanda ang database ng Aira...</Text>
          </View>
        )}

        {/* Initialization Error State with Retry Button */}
        {!initializing && initError && (
          <View style={styles.centerContainer}>
            <Text style={styles.errorTitle}>Hindi Masimulan ang Aira</Text>
            <Text style={styles.errorMessage}>{initError}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => setAttempt((value) => value + 1)}
              accessibilityRole="button"
              accessibilityLabel="Subukang muli ang pagsisimula"
            >
              <Text style={styles.retryButtonText}>Subukan Muli</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main Content when DB is Ready */}
        {!initializing && !initError && db && (
          <View style={styles.contentContainer}>
            <ModeSelector
              currentMode={activeMode}
              onSelectMode={handleSelectMode}
            />

            <View style={styles.viewSlot}>
              {activeMode === 'ask-price' && <AskPriceView db={db} />}
              {activeMode === 'sell' && <SellView db={db} />}
              {activeMode === 'manage' && <ManageProductsView db={db} />}
            </View>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  appHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  appName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0284c7',
    letterSpacing: 0.5,
  },
  appDescriptor: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748b',
  },
  offlineBadge: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  offlineText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  warningBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#92400e',
    fontWeight: '500',
  },
  warningDismiss: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  warningDismissText: {
    fontSize: 14,
    color: '#92400e',
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#64748b',
    fontWeight: '500',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#b91c1c',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: '#4b5563',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  contentContainer: {
    flex: 1,
  },
  viewSlot: {
    flex: 1,
  },
});
