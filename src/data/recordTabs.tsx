import {
  Bomb,
  Zap,
  Sparkles,
  Sliders,
  Layers,
  ShieldAlert,
  Code2,
  Cpu,
  Crosshair,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type RecordTabId =
  | 'missile'
  | 'action'
  | 'burst'
  | 'sprite'
  | 'advanced'
  | 'collisions'
  | 'callbacks'
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
  /** A sub-section of another tab: shown under it in the sidebar, indented in
   *  the mobile picker, and ordered right after its parent in this list. */
  parent?: RecordTabId;
}

/** The record editor's sections, shared by the sidebar and the mobile nav. */
export const RECORD_TABS: RecordTabDef[] = [
  { id: 'missile', label: 'Flight & Physics', hint: 'Gravity, wind, fuse, damage', icon: Bomb },
  { id: 'action', label: 'Missile Action', hint: 'Bounce, homing, roam, dig', icon: Zap },
  { id: 'burst', label: 'Burst Payload', hint: 'Clusters, fire, plain blast', icon: Sparkles },
  { id: 'burst_bit', label: 'Bit Behaviour', hint: 'Child body, art and trail', icon: Cpu, parent: 'burst' },
  { id: 'burst_bit_collision', label: 'Bit Collision', hint: 'What stops the child', icon: ShieldAlert, parent: 'burst' },
  { id: 'burst_bit_bounce', label: 'Bit Bounce', hint: 'Bounciness, sound, contact blast', icon: Layers, parent: 'burst' },
  { id: 'burst_bit_homing', label: 'Bit Homing', hint: 'Lock, arming, steering, art', icon: Crosshair, parent: 'burst' },
  { id: 'burst_bit_roam', label: 'Bit Roam', hint: 'Walk, jumps, gas, targets', icon: Zap, parent: 'burst' },
  { id: 'burst_bit_dig', label: 'Bit Dig', hint: 'Sound and digging frames', icon: Sliders, parent: 'burst' },
  { id: 'sprite', label: 'Indices & Trail', hint: 'Sprite, trail, sounds', icon: Sliders },
  { id: 'advanced', label: 'Advanced', hint: 'Explosion, collision, motion', icon: Layers },
  {
    id: 'collisions',
    label: 'Collision Bitmask',
    hint: 'What stops the action',
    icon: ShieldAlert,
    parent: 'action',
  },
  { id: 'callbacks', label: 'Lua Callbacks', hint: 'Custom event handlers', icon: Code2 },
  { id: 'gun_mine', label: 'Family Specifics', hint: 'Gun, mine, strike, special, arrow', icon: Cpu },
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

/**
 * Tabs for the current record. The burst sub-sections are navigation helpers
 * over one page, so they only appear while the payload really has cluster bits,
 * and an action section only while that bit action is selected.
 */
export function visibleRecordTabs(burst: string | undefined, bitAction: string): RecordTabDef[] {
  return RECORD_TABS.filter((tab) => {
    if (tab.parent !== 'burst') return true;
    if (burst !== 'clusters') return false;
    if (tab.id === 'burst_bit' || tab.id === 'burst_bit_collision') return true;
    return tab.id === (`burst_bit_${bitAction}` as RecordTabId);
  });
}
