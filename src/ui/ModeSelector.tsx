import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { AppMode } from '../types.ts';
import { AppIcon } from './AppIcon.tsx';
import { colors } from './theme.ts';

interface ModeSelectorProps {
  currentMode: AppMode;
  onSelectMode: (mode: AppMode) => void;
}

interface ModeOption {
  key: AppMode;
  label: string;
  icon: 'search' | 'chart' | 'store';
  accessibilityLabel: string;
}

const MODES: ModeOption[] = [
  { key: 'ask-price', label: 'Presyo', icon: 'search', accessibilityLabel: 'Presyo' },
  { key: 'sell', label: 'Benta', icon: 'chart', accessibilityLabel: 'Benta' },
  { key: 'manage', label: 'Tindahan', icon: 'store', accessibilityLabel: 'Tindahan' },
];

export function ModeSelector({ currentMode, onSelectMode }: ModeSelectorProps): React.JSX.Element {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      {MODES.map((mode) => {
        const isActive = currentMode === mode.key;
        return (
          <TouchableOpacity
            key={mode.key}
            style={styles.tabButton}
            onPress={() => onSelectMode(mode.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={mode.accessibilityLabel}
            activeOpacity={0.7}
          >
            <View style={[styles.iconCapsule, isActive && styles.activeIconCapsule]}>
              <AppIcon
                name={mode.icon}
                size={22}
                color={isActive ? colors.primary : colors.muted}
              />
            </View>
            <Text style={[styles.label, isActive ? styles.activeLabel : styles.inactiveLabel]}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 72,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tabButton: {
    flex: 1,
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  iconCapsule: {
    width: 60,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  activeIconCapsule: {
    backgroundColor: colors.selected,
  },
  label: {
    fontSize: 12,
    marginTop: 3,
    textAlign: 'center',
  },
  activeLabel: {
    color: colors.primary,
    fontWeight: '700',
  },
  inactiveLabel: {
    color: colors.muted,
    fontWeight: '500',
  },
});
