import type { WepBaseline, WeaponProject } from '../types/weapon';
import { stockDonor, stockDonorBaseline } from '../data/stockDonors';

/**
 * Re-basing a `copy_from` weapon onto another stock donor.
 *
 * The panels *are* the donor's record: a fresh project is the Grenade because
 * that is its `copy_from`, and every value it shows is a value the engine gets
 * either from the donor or from the claim. So when the donor changes, the
 * record has to follow it — otherwise the project keeps showing (and diffing
 * against) the previous donor while the claim copies the new one.
 *
 * The old donor is also the generator's diff base, which turned that mismatch
 * into silent data loss: a Mortar re-based from the Grenade trusted the
 * Grenade's `burst = nothing` and `push_pct = 100`, so turning the Mortar's
 * clustlets off and setting its push to 100 wrote *neither*, and the engine
 * played the Mortar's own clusters and its 0% push. This fixes the state;
 * `luaGenerator`'s baseline check is the second line of defence for a project
 * that reaches the generator some other way.
 *
 * What the author actually changed is kept: a value that differs from the old
 * donor's record is an edit and survives the switch. Everything still equal to
 * the old donor is inherited, so it takes the new donor's value.
 */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Take the new donor's value unless the author changed this one. */
function rebaseValue<T>(next: T, current: T, base: T | undefined): T {
  if (base === undefined || current === undefined) return next;
  return same(current, base) ? next : current;
}

/**
 * One record group, re-based key by key.
 *
 * `dropMissing` is for `recordOverrides`: a key the new donor does not declare
 * and the author never edited is the old donor's own value (the Grenade's
 * `missile.bounce.sound = 0`, say) and must go, or it would be written onto the
 * new record as an edit. The typed groups keep their shape instead — a body
 * field the new donor does not name keeps the value the panels already show.
 */
function rebaseGroup<T extends Record<string, any>>(
  next: T | undefined,
  current: T | undefined,
  base: T | undefined,
  dropMissing: boolean,
): T | undefined {
  if (!next && !current) return undefined;
  const out: Record<string, any> = {};
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(next ?? {})]);
  for (const key of keys) {
    const donorValue = next ? next[key] : undefined;
    const currentValue = current ? current[key] : undefined;
    const baseValue = base ? base[key] : undefined;
    const edited =
      base !== undefined && baseValue !== undefined && !same(currentValue, baseValue);
    if (edited) {
      out[key] = currentValue;
    } else if (donorValue !== undefined) {
      out[key] = donorValue;
    } else if (!dropMissing && currentValue !== undefined) {
      out[key] = currentValue;
    }
  }
  return out as T;
}

/** The project re-based on `donorSlot`, keeping the author's own edits. */
export function rebaseToDonor(project: WeaponProject, donorSlot: string): WeaponProject {
  // `based_on` is a plain slot id in the UI, but a decoded/project-imported one
  // can carry the `stock.` prefix the claim uses.
  const donorId = donorSlot.replace(/^stock\./, '');
  const donor = stockDonor(donorId);
  const next = stockDonorBaseline(donorId);
  if (!donor?.body || !next?.body) {
    // A donor the table does not know: keep every value and let the generator
    // treat it as "no baseline" (it writes the whole record rather than
    // silently inheriting a donor nobody can diff against).
    return { ...project, based_on: donorSlot };
  }

  const old: WepBaseline | undefined = project.donorBaseline;
  const body = rebaseGroup(next.body, project.body, old?.body, false) ?? next.body;
  const clustlet =
    rebaseGroup(next.body.clustlet, project.body.clustlet, old?.body?.clustlet, false) ??
    next.body.clustlet;

  return {
    ...project,
    based_on: donorSlot,
    donorBaseline: next,
    body: { ...body, clustlet },
    action: rebaseValue(next.action, project.action, old?.action),
    burst: rebaseValue(next.burst, project.burst, old?.burst),
    specialSubtype: rebaseValue(next.specialSubtype, project.specialSubtype, old?.specialSubtype),
    recordOverrides:
      rebaseGroup(next.recordOverrides, project.recordOverrides, old?.recordOverrides, true) ?? {},
    roamConfig: rebaseGroup(next.roamConfig, project.roamConfig, old?.roamConfig, false) ?? next.roamConfig,
    digConfig: rebaseGroup(next.digConfig, project.digConfig, old?.digConfig, false) ?? next.digConfig,
    fireConfig: rebaseGroup(next.fireConfig, project.fireConfig, old?.fireConfig, false) ?? next.fireConfig,
  };
}
