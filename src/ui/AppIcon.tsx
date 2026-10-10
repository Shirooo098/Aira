import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from './theme.ts';

export type IconName = 'search' | 'chart' | 'store' | 'mic' | 'edit' | 'close' | 'info' | 'tag';

export function AppIcon({ name, color = colors.primary, size = 24 }: {
  name: IconName; color?: string; size?: number;
}): React.JSX.Element {
  const line = { backgroundColor: color };
  const outline = { borderColor: color };
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      <View style={[styles.canvas, { left: (size - 24) / 2, top: (size - 24) / 2, transform: [{ scale: size / 24 }] }]}>
        {name === 'search' && <>
          <View style={[styles.lens, outline]} />
          <View style={[styles.searchHandle, line]} />
        </>}
        {name === 'chart' && <>
          <View style={[styles.bar, { left: 3, height: 8 }, line]} />
          <View style={[styles.bar, { left: 10, height: 13 }, line]} />
          <View style={[styles.bar, { left: 17, height: 19 }, line]} />
        </>}
        {name === 'store' && <>
          <View style={[styles.shopRoof, outline]} />
          <View style={[styles.shopBody, outline]} />
          <View style={[styles.shopDoor, outline]} />
          <View style={[styles.shopAwning, outline]} />
        </>}
        {name === 'mic' && <>
          <View style={[styles.microphone, outline]} />
          <View style={[styles.microphoneCup, outline]} />
          <View style={[styles.microphoneStem, line]} />
          <View style={[styles.microphoneFoot, line]} />
        </>}
        {name === 'edit' && <>
          <View style={[styles.pencil, outline]} />
          <View style={[styles.pencilTip, line]} />
        </>}
        {name === 'close' && <>
          <View style={[styles.cross, line, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.cross, line, { transform: [{ rotate: '-45deg' }] }]} />
        </>}
        {name === 'info' && <>
          <View style={[styles.infoRing, outline]} />
          <View style={[styles.infoDot, line]} />
          <View style={[styles.infoStem, line]} />
        </>}
        {name === 'tag' && <>
          <View style={[styles.tag, outline]} />
          <View style={[styles.tagHole, line]} />
        </>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { width: 24, height: 24, position: 'absolute' },
  lens: { position: 'absolute', left: 2, top: 2, width: 15, height: 15, borderWidth: 2, borderRadius: 8 },
  searchHandle: { position: 'absolute', left: 17, top: 13, width: 2, height: 10, borderRadius: 1, transform: [{ rotate: '-45deg' }] },
  bar: { position: 'absolute', bottom: 2, width: 3, borderRadius: 1.5 },
  shopRoof: { position: 'absolute', left: 3, top: 3, width: 18, height: 5, borderWidth: 2, borderRadius: 2 },
  shopBody: { position: 'absolute', left: 4, top: 8, width: 16, height: 14, borderWidth: 2, borderTopWidth: 0, borderRadius: 1 },
  shopDoor: { position: 'absolute', left: 10, top: 14, width: 6, height: 8, borderWidth: 2 },
  shopAwning: { position: 'absolute', left: 3, top: 6, width: 18, height: 5, borderWidth: 2, borderRadius: 3 },
  microphone: { position: 'absolute', left: 8, top: 1, width: 8, height: 13, borderWidth: 2, borderRadius: 5 },
  microphoneCup: { position: 'absolute', left: 5, top: 8, width: 14, height: 10, borderWidth: 2, borderTopWidth: 0, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  microphoneStem: { position: 'absolute', left: 11, top: 17, width: 2, height: 5 },
  microphoneFoot: { position: 'absolute', left: 7, top: 21, width: 10, height: 2, borderRadius: 1 },
  pencil: { position: 'absolute', left: 8, top: 2, width: 7, height: 18, borderWidth: 2, borderRadius: 1, transform: [{ rotate: '45deg' }] },
  pencilTip: { position: 'absolute', left: 3, top: 19, width: 4, height: 3, borderRadius: 1, transform: [{ rotate: '-15deg' }] },
  cross: { position: 'absolute', left: 11, top: 3, width: 2, height: 18, borderRadius: 1 },
  infoRing: { position: 'absolute', left: 2, top: 2, width: 20, height: 20, borderWidth: 2, borderRadius: 10 },
  infoDot: { position: 'absolute', left: 11, top: 6, width: 2, height: 2, borderRadius: 1 },
  infoStem: { position: 'absolute', left: 11, top: 10, width: 2, height: 7, borderRadius: 1 },
  tag: { position: 'absolute', left: 6, top: 3, width: 12, height: 18, borderWidth: 2, borderTopLeftRadius: 4, borderTopRightRadius: 4, transform: [{ rotate: '45deg' }] },
  tagHole: { position: 'absolute', left: 14, top: 5, width: 3, height: 3, borderRadius: 2 },
});
