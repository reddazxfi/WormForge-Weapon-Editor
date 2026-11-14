import {
  Bomb,
  Zap,
  Sparkles,
  Sliders,
  Code2,
  Crosshair,
  Plane,
  Wrench,
  Flame,
  Navigation,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FireType } from '../types/weapon';

export type RecordTabId =
  | 'missile'
  | 'action'
  | 'burst'
  | 'sprite'
  | 'collisions'
  | 'callbacks'
  | 'gun'
  | 'strike'
  | 'gun_mine'
  | 'burst_bit'
  | 'burst_bit_collision'
  | 'burst_bit_bounce'
  | 'burst_bit_homing'
  | 'burst_bit_roam'
  | 'burst_bit_dig';

export interface RecordTabDef {
  id: RecordTabId;
  label: string;
  hint: string;
  icon: LucideIcon;
  parent?: RecordTabId;
}

/** Canonical definitions for every section in the Weapon Record workbench. */
export const RECORD_TABS: RecordTabDef[] = [
  { id: 'missile', label: 'Physics & Blast', hint: 'Power, gravity, wind, fuse & handling', icon: Bomb },
  { id: 'action', label: 'Missile Action', hint: 'Bounce, homing, roam, dig & targets', icon: Zap },
  { id: 'burst', label: 'Explodes Into', hint: 'Single blast, cluster bits or fire', icon: Sparkles },
  { id: 'sprite', label: 'Sprites & Trail', hint: 'Missile sprite, smoke trail & sounds', icon: Sliders },
  { id: 'gun', label: 'Firearm Specs', hint: 'Bullets, spread cone, pellets & hits', icon: Crosshair },
  { id: 'gun_mine', label: 'Tool & Setup', hint: 'Mine, arrow, teleport or special tool', icon: Wrench },
  { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
];

/** The cluster bit's action, from the same expression the editor uses. */
export function bitActionOf(clustlet: {
  bit_action?: string;
  homing?: string;
  contact?: string;
}): string {
  return (
    clustlet.bit_action ??
    (clustlet.homing !== 'off' ? 'homing' : clustlet.contact === 'bounce' ? 'bounce' : 'none')
  );
}

/** Whether the current weapon configuration has a native projectile body. */
export function hasProjectileBody(
  fireType?: FireType,
  teleport?: boolean,
  bodyFuse?: boolean
): boolean {
  if (!fireType || fireType === 'power') return true;
  if (fireType === 'cursor') return !teleport;
  if (fireType === 'drop') return !!bodyFuse;
  return false;
}

/**
 * Sections strictly restricted to what actually applies to the selected
 * Fire Archetype (plus Mine vs. Dynamite and Air Strike vs. Teleport modes).
 */
export function visibleRecordTabs(
  _burst: string | undefined,
  _bitAction: string,
  fireType?: FireType,
  teleport?: boolean,
  bodyFuse?: boolean
): RecordTabDef[] {
  if (fireType === 'hitscan') {
    return [
      { id: 'gun', label: 'Firearm Specs', hint: 'Bullets, spread cone, damage & hits', icon: Crosshair },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  if (fireType === 'spray') {
    return [
      { id: 'gun', label: 'Flame Inspector', hint: 'Raw 0x3c–0x64 stream parameters', icon: Flame },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  if (fireType === 'drop' && !bodyFuse) {
    return [
      { id: 'gun_mine', label: 'Mine Setup', hint: 'Proximity sensor, timers & blast', icon: Wrench },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  if (fireType === 'cursor' && teleport) {
    return [
      { id: 'gun_mine', label: 'Teleport Setup', hint: 'Cursor placement & firing animation', icon: Navigation },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  if (fireType === 'arrow') {
    return [
      { id: 'gun_mine', label: 'Arrow Specs', hint: 'Direct-hit damage & firing animation', icon: Wrench },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  if (fireType === 'special') {
    return [
      { id: 'gun_mine', label: 'Special Tool', hint: 'Tool subtype & native behaviour', icon: Wrench },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
    ];
  }

  const isStrike = fireType === 'cursor' && !teleport;
  return [
    {
      id: 'missile',
      label: isStrike ? 'Strike & Bombs' : 'Physics & Blast',
      hint: isStrike ? 'Aircraft drop & bomb physics' : 'Power, gravity, wind, fuse & blast',
      icon: isStrike ? Plane : Bomb,
    },
    { id: 'action', label: 'Missile Action', hint: 'Bounce, homing, roam, dig & targets', icon: Zap },
    { id: 'burst', label: 'Explodes Into', hint: 'Single blast, cluster bits or fire', icon: Sparkles },
    { id: 'sprite', label: 'Sprites & Trail', hint: 'Missile sprite, smoke trail & sounds', icon: Sliders },
      { id: 'callbacks', label: 'Lua Script', hint: 'Custom game event hooks', icon: Code2 },
  ];
}
