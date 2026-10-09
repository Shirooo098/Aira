import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { AppMode } from '../types.ts';

interface ModeSelectorProps {
  currentMode: AppMode;
  onSelectMode: (mode: AppMode) => void;
}

interface ModeOption {
  key: AppMode;
  label: string;
  sublabel: string;
}

const MODES: ModeOption[] = [
  { key: 'ask-price', label: 'Alamin ang Presyo', sublabel: 'Ask Price' },
  { key: 'sell', label: 'Benta', sublabel: 'Sell' },
  { key: 'manage', label: 'Pamahalaan', sublabel: 'Manage' },
];

export function ModeSelector({ currentMode, onSelectMode }: ModeSelectorProps): React.JSX.Element {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      {MODES.map((mode) => {
        const isActive = currentMode === mode.key;
        return (
          <TouchableOpacity
            key={mode.key}
            style={[styles.button, isActive && styles.activeButton]}
            onPress={() => onSelectMode(mode.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${mode.label}, ${mode.sublabel}`}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isActive && styles.activeLabel]}>
              {mode.label}
            </Text>
            <Text style={[styles.sublabel, isActive && styles.activeSublabel]}>
              {mode.sublabel}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 4,
    marginHorizontal: 16,
    marginVertical: 8,
  },
  button: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  activeButton: {
    backgroundColor: '#0284c7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'center',
  },
  activeLabel: {
    color: '#ffffff',
  },
  sublabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  activeSublabel: {
    color: '#e0f2fe',
  },
});
