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
import { colors, radii } from './src/ui/theme.ts';
import { AppIcon } from './src/ui/AppIcon.tsx';
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
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

        {/* Top App Header: Aira wordmark with small apricot rays, no offline badge */}
        <View style={styles.appHeader}>
          <View style={styles.brandRow}>
            <Text style={styles.brandName}>Aira</Text>
            <View style={styles.raysContainer} accessible={false} importantForAccessibility="no-hide-descendants">
              <View style={[styles.ray, styles.rayTop]} />
              <View style={[styles.ray, styles.rayMiddle]} />
              <View style={[styles.ray, styles.rayBottom]} />
            </View>
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
              <AppIcon name="close" color={colors.warning} />
            </TouchableOpacity>
          </View>
        )}

        {/* Database Initialization Loading State */}
        {initializing && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
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

        {/* Main Content when DB is Ready: viewSlot then ModeSelector below */}
        {!initializing && !initError && db && (
          <View style={styles.contentContainer}>
            <View style={styles.viewSlot}>
              {activeMode === 'ask-price' && <AskPriceView db={db} />}
              {activeMode === 'sell' && <SellView db={db} />}
              {activeMode === 'manage' && <ManageProductsView db={db} />}
            </View>

            <ModeSelector
              currentMode={activeMode}
              onSelectMode={handleSelectMode}
            />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: colors.background,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandName: {
    fontSize: 28,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.5,
  },
  raysContainer: {
    width: 14,
    height: 14,
    marginLeft: 3,
    marginBottom: 10,
    position: 'relative',
  },
  ray: {
    position: 'absolute',
    backgroundColor: colors.accent,
    borderRadius: 1.5,
  },
  rayTop: {
    width: 7,
    height: 2.5,
    top: 2,
    left: 2,
    transform: [{ rotate: '-40deg' }],
  },
  rayMiddle: {
    width: 7,
    height: 2.5,
    top: 6,
    left: 4,
    transform: [{ rotate: '5deg' }],
  },
  rayBottom: {
    width: 7,
    height: 2.5,
    top: 10,
    left: 2,
    transform: [{ rotate: '50deg' }],
  },
  warningBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderBottomWidth: 1,
    borderBottomColor: colors.warningOutline,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: colors.warning,
    fontWeight: '500',
  },
  warningDismiss: {
    minWidth: 48,
    minHeight: 48,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningDismissText: {
    fontSize: 14,
    color: colors.warning,
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
    color: colors.muted,
    fontWeight: '500',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.error,
    marginBottom: 8,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: colors.primary,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.button,
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
