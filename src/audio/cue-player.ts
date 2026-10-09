import { createAudioPlayer } from 'expo-audio';
import type { AppMode } from '../types.ts';

const SOUND_ASSETS: Record<AppMode, number> = {
  'ask-price': require('../../assets/sounds/ask-price.wav'),
  sell: require('../../assets/sounds/sell.wav'),
  manage: require('../../assets/sounds/manage.wav'),
};

const players: Partial<Record<AppMode, ReturnType<typeof createAudioPlayer>>> = {};

export interface PlayCueResult {
  ok: boolean;
  error?: string;
}

export async function playModeCue(mode: AppMode): Promise<PlayCueResult> {
  try {
    const asset = SOUND_ASSETS[mode];
    if (!asset) {
      return { ok: false, error: `Walang audio cue para sa ${mode}` };
    }

    let player = players[mode];
    if (!player) {
      player = createAudioPlayer(asset);
      players[mode] = player;
    }
    await player.seekTo(0);
    player.play();
    return { ok: true };
  } catch (err) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[Aira Audio Cue] Hindi napatugtog ang cue para sa ${mode}:`, err);
    }
    return { ok: false, error: 'Hindi mapatugtog ang tunog. Maaari pa ring gamitin ang mga tab.' };
  }
}

export function disposeAudioPlayers(): void {
  for (const mode of Object.keys(players) as AppMode[]) {
    try {
      const player = players[mode];
      if (player) {
        player.pause();
        player.release?.();
      }
    } catch (err) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn(`[Aira Audio Cue] Error releasing player for ${mode}:`, err);
      }
    }
    delete players[mode];
  }
}
