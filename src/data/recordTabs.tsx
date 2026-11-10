import { Bomb, Zap, Sparkles, Sliders, Layers, ShieldAlert, Code2, Cpu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type RecordTabId =
  | 'missile'
  | 'action'
  | 'burst'
  | 'sprite'
  | 'advanced'
  | 'collisions'
  | 'callbacks'
  | 'gun_mine';

export interface RecordTabDef {
  id: RecordTabId;
  label: string;
  hint: string;
  icon: LucideIcon;
}

/** The record editor's sections, shared by the sidebar and the mobile nav. */
export const RECORD_TABS: RecordTabDef[] = [
  { id: 'missile', label: 'Flight & Physics', hint: 'Gravity, wind, fuse, damage', icon: Bomb },
  { id: 'action', label: 'Missile Action', hint: 'Bounce, homing, roam, dig', icon: Zap },
  { id: 'burst', label: 'Burst Payload', hint: 'Clusters, fire, plain blast', icon: Sparkles },
  { id: 'sprite', label: 'Indices & Particles', hint: 'Sprite, trail, sounds', icon: Sliders },
  { id: 'advanced', label: 'Advanced', hint: 'Explosion, collision, motion', icon: Layers },
  { id: 'collisions', label: 'Collision Bitmask', hint: 'What stops the missile', icon: ShieldAlert },
  { id: 'callbacks', label: 'Lua Callbacks', hint: 'Custom event handlers', icon: Code2 },
  { id: 'gun_mine', label: 'Gun / Mine Specifics', hint: 'Hitscan, mine, strike', icon: Cpu },
];
