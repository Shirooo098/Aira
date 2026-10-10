import test from 'node:test';
import assert from 'node:assert/strict';
import { colors } from '../src/ui/theme.ts';

function luminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/i);
  const channels = [1, 3, 5].map(offset => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test('theme keeps body, placeholder, action and feedback text readable', () => {
  const pairs = [
    [colors.text, colors.surface],
    [colors.muted, colors.surfaceSoft],
    [colors.muted, colors.background],
    [colors.primaryMuted, colors.lilac],
    [colors.primary, colors.selected],
    [colors.primary, colors.accent],
    [colors.surface, colors.primary],
    [colors.success, colors.successSoft],
    [colors.warning, colors.warningSoft],
    [colors.error, colors.errorSoft],
  ];
  for (const [foreground, background] of pairs) {
    const lightness = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    const contrast = (lightness[0] + 0.05) / (lightness[1] + 0.05);
    assert.ok(contrast >= 4.5, `${foreground} on ${background}: ${contrast.toFixed(2)}:1`);
  }
});
