/**
 * `fires.subtype` (record +0x34): which of WA's stock fire animations and
 * sounds the worm plays when the weapon is used.
 *
 * The number is the stock weapon's own subtype (`crates/weapons/src/record.rs`,
 * `stock_subtype`), so 4 is the Minigun's burst (shell casings and its firing
 * loop) and 5 the Shotgun's pump/cock. It applies to every family: a missile
 * with subtype 5 fires with the shotgun's animation and sound, even though its
 * projectile is unchanged. It has nothing to do with the held-art animation.
 *
 * 0 is a real value ("no special firing behaviour"), not "inherit": use the
 * donor's own number when the weapon should keep it, which the generator does
 * by diffing against the donor.
 */
export const FIRE_SUBTYPES: { value: number; label: string }[] = [
  { value: 0, label: '0 — plain (no special firing animation)' },
  { value: 1, label: '1 — Uzi (rapid single shots)' },
  { value: 2, label: '2 — Grenade throw' },
  { value: 3, label: '3 — Bazooka launch' },
  { value: 4, label: '4 — Minigun (shells + firing loop)' },
  { value: 5, label: '5 — Shotgun (pump / cock)' },
  { value: 6, label: '6 — Handgun' },
  { value: 7, label: '7 — Homing Pigeon' },
  { value: 8, label: '8 — Sheep Launcher' },
  { value: 9, label: '9 — Flame Thrower' },
  { value: 10, label: '10 — Longbow' },
  { value: 11, label: '11 — Mortar' },
  { value: 12, label: '12 — Homing Missile' },
  { value: 13, label: '13 — Surrender' },
  { value: 14, label: '14 — Skip Go' },
  { value: 15, label: '15 — Select Worm' },
  { value: 16, label: '16 — Nuclear Test' },
  { value: 17, label: '17 — Girder / Girder Pack' },
  { value: 18, label: '18 — Battle Axe' },
  { value: 19, label: '19 — Turn utility' },
  { value: 20, label: '20 — Freeze' },
  { value: 21, label: '21 — Earthquake' },
  { value: 22, label: '22 — Scales of Justice' },
  { value: 23, label: '23 — Jet Pack' },
  { value: 24, label: '24 — Armageddon' },
  { value: 70, label: '70 — Napalm Strike' },
  { value: 200, label: '200 — Mail Strike' },
  { value: 260, label: '260 — MB Bomb' },
];

/** The label for a value, or `null` when it is not one of the stock subtypes. */
export function fireSubtypeLabel(value: number): string | null {
  return FIRE_SUBTYPES.find((entry) => entry.value === value)?.label ?? null;
}
