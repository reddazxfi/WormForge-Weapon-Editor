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
  Plane,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FireType } from '../types/weapon';

export type RecordTabId =
  | 'missile'
  | 'action'
  | 'burst'
  | 'sprite'
  | 'advanced'
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
  /** A sub-section of another tab: shown under it in the sidebar, indented in
   *  the mobile picker, and ordered right after its parent in this list. */
  parent?: RecordTabId;
}

/** The record editor's sections, shared by the sidebar and the mobile nav. */
export const RECORD_TABS: RecordTabDef[] = [
  { id: 'missile', label: 'Flight & Physics', hint: 'Gravity, wind, fuse, damage', icon: Bomb },
  { id: 'action', label: 'Missile Action', hint: 'Bounce, homing, roam, dig', icon: Zap },
  {
    id: 'collisions',
    label: 'Collision Targets',
    hint: 'What ends flight or bounces',
    icon: ShieldAlert,
    parent: 'action',
  },
  { id: 'burst', label: 'Explodes Into', hint: 'Plain blast, clusters, or fire', icon: Sparkles },
  { id: 'burst_bit', label: 'Cluster Bits', hint: 'Child physics, sprite & trail', icon: Cpu, parent: 'burst' },
  { id: 'burst_bit_collision', label: 'Bit Collisions', hint: 'What stops or bounces bits', icon: ShieldAlert, parent: 'burst' },
  { id: 'burst_bit_bounce', label: 'Bit Bounce', hint: 'Bounciness, sound, contact blast', icon: Layers, parent: 'burst' },
  { id: 'burst_bit_homing', label: 'Bit Homing', hint: 'Guidance mode, delay, art', icon: Crosshair, parent: 'burst' },
  { id: 'burst_bit_roam', label: 'Bit Roaming', hint: 'Walk, jumps, gas, targets', icon: Zap, parent: 'burst' },
  { id: 'burst_bit_dig', label: 'Bit Digging', hint: 'Sound and digging frames', icon: Sliders, parent: 'burst' },
  { id: 'sprite', label: 'Sprites & Trail', hint: 'Stock sprites, smoke trail, audio', icon: Sliders },
  { id: 'advanced', label: 'Advanced', hint: 'Blast shape, wobble, extras', icon: Layers },
  { id: 'gun', label: 'Hitscan Gun', hint: 'Bullets, spread cone, pellets, hits', icon: Crosshair },
  { id: 'strike', label: 'Air Strike', hint: 'Plane, drop count, spacing, speed', icon: Plane },
  { id: 'gun_mine', label: 'Mine & Specials', hint: 'Proximity mine, arrow, special tools', icon: Wrench },
  { id: 'callbacks', label: 'Lua Callbacks', hint: 'Custom event scripts', icon: Code2 },
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
 * Tabs for the current record. Family-specific tabs (`gun`, `strike`,
 * `gun_mine`) only appear when the matching Fire Archetype is selected
 * (`spray` shares `gun` parameters for inspection), and cluster bit
 * sub-sections only appear while `Explodes Into` is Clusters.
 */
export function visibleRecordTabs(
  burst: string | undefined,
  bitAction: string,
  fireType?: FireType,
  teleport?: boolean
): RecordTabDef[] {
  return RECORD_TABS.filter((tab) => {
    if (tab.id === 'gun') return fireType === 'hitscan' || fireType === 'spray';
    if (tab.id === 'strike') return fireType === 'cursor' && !teleport;
    if (tab.id === 'gun_mine') {
      return fireType === 'drop' || fireType === 'arrow' || fireType === 'special';
    }
    if (tab.parent !== 'burst') return true;
    if (burst !== 'clusters') return false;
    if (tab.id === 'burst_bit' || tab.id === 'burst_bit_collision') return true;
    return tab.id === (`burst_bit_${bitAction}` as RecordTabId);
  });
}
