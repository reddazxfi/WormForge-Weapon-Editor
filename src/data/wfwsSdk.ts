// AUTO-SYNCED from spec/lua_sdk/wfws_sdk — do not edit inline.
// Re-sync: copy the files and re-run tools/sync_wfws_sdk.ts (if added).

/** mod.toml for the wfws.sdk library bundle. */
export const WFWS_SDK_MOD_TOML = `# WFWS Sprite Builder -- the editor's own flight-art builder.
#
# A library bundle: no components of its own, so it never appears on a panel.
# A weapon pulls it in with \`dependencies = ["wfws.sdk"]\` and then:
#
#   local sb = require("wf-lib/wfws_sprite_builder")
#
# \`holds\` lives in wf.sdk and is required by its public module name, so that
# dependency is declared below. \`wf.sdk\` also keeps the hold builder working;
# this bundle only replaces the flight builder.
id = "wfws.sdk"
name = "WFWS Sprite Builder"
version = "0.1.0"
author = "WormForge Weapon Editor"
api_version = 4
format_version = 2
dependencies = ["wf.sdk"]

[exports]
"wf-lib/wfws_sprite_builder" = "lib/wfws_sprite_builder.lua"
`;

/** Lua source for wf-lib/wfws_sprite_builder (the WFWS flight art builder). */
export const WFWS_SPRITE_BUILDER_LUA = `-- wfws_sprite_builder.lua -- WFWS's own fork of PX's sprite builder.
--
-- Two layers of gating:
--
--   IDENTITY (decided once, on first sight): which kind of missile is this?
--     primary, cluster bit, or an extra \`roles\` entry. Cached per missile id.
--
--   STATE (re-evaluated every pre phase): what is it doing right now?
--     homing, digging, roaming, emitting gas... Each state may swap the art,
--     the animation, or hand the missile back to WA (native = true).
--
-- API:
--
--   sb.flight(ctx, {
--     weapon = ctx.id,
--     sheet = "...", anim = "track", ...        -- primary art
--     bits  = { sheet = "...", ... } | "inherit" | nil/false (native)
--     is_bit = function(m) ... end,             -- optional classifier override
--     roles  = { { name = "x", match = function(m) ... end, sheet = "..." } },
--     states = {
--       { scope = "main" | "bit" | "any" | <role name>,
--         sig  = 245 | { 246, 247, 248 },       -- native sprite ids that mean
--                                               -- "in this state"
--         when = function(m) ... end,           -- or any custom test
--         sheet = "...", anim = "...", ...      -- art for this state
--         native = true },                      -- OR: leave WA's art alone
--     },
--   })
--
-- STATE SIGNAL: WA writes a new nonzero value to m.sprite when a missile
-- changes behaviour (homing sprite, dig frames, gas pose...). The pre phase
-- records the last nonzero value seen BEFORE this module zeroes it, so the
-- signal survives even if WA only writes it once. \`sig\` matches against it.
-- States are checked in order; first match wins; no match = identity art.
--
-- The generator should give each state a distinct sprite id in the record
-- (homing.sprite, dig.dive_sprite / sprite_1..3, roam.gas.animal_sprite,
-- sheep.flight_1/2) and use the same ids as \`sig\`.
--
-- Default bit test: \`m.sprite ~= 0\` at first sight, so write \`sprite = 0\` on the
-- PRIMARY's record. Pass is_bit if you cannot.
--
-- Pure data at load: \`wa\` is touched only inside M.flight and its callbacks.
--
-- Bundle: wfws.sdk (spec/lua_sdk/wfws_sdk). \`holds\` is exported by the
-- \`wf.sdk\` dependency, so this bundle requires it by its public module name.

local shared = require("wf-lib/holds")

local M = {}

local ANIM_TYPE = {
  track = 2,
  rotation = 3,
  slow = 1,
  medium = 1,
  fast = 1,
  none = 5,
}
local ANIM_SPEED = { slow = 0.5, medium = 0.8, fast = 1.35 }

local function current_worm()
  for _, w in ipairs(wa.worms.all()) do
    if w.turn then return w end
  end
end

local function sign(n) return n > 0 and 1 or (n < 0 and -1 or 0) end

function M.cyclical_frame(phase, anim_speed, num_frames)
  if not phase then phase = 0.0 end
  local spd = (anim_speed or 1.0) * 30 / 1000
  phase = phase + spd
  if phase > 0.99 then phase = 0.0 end
  local frame = math.floor(phase * num_frames) % num_frames
  return frame, phase
end

function M.track_angle(vx, vy)
  return -wa.math.atan(vx, vy) - math.pi
end

function M.rotation_turn(prev_rot, vx, vy, spin)
  return (prev_rot or 0) + (spin or 1.0) * 0.5 * (vx * 0.15 + math.abs(vy) * 0.01 * sign(vx))
end

function M.spin_turn(prev_rot, vx, anim_speed)
  return (prev_rot or 0) + (anim_speed or 0.5) * 0.5 * sign(vx)
end

-- Sentinel: a missile (or state) the builder leaves to WA.
local NATIVE = {}

local function resolve(o)
  local anim = o.anim or "none"
  return {
    sheet = o.sheet,
    anim = anim,
    anim_type = ANIM_TYPE[anim],
    spin = o.spin or 1.0,
    cyclical = o.cyclical or 0,
    anim_speed = o.anim_speed or 1.0,
    z = o.z or 5.0,
    scale = o.scale or 1.0,
    mirror = o.mirror ~= false,
    frame_fn = o.frame_fn,
    turn_fn = o.turn_fn,
  }
end

local function sigset(v)
  if v == nil then return nil end
  local s = {}
  if type(v) == "table" then
    for i = 1, #v do s[v[i]] = true end
  else
    s[v] = true
  end
  return s
end

function M.flight(ctx, opts)
  if not opts or not opts.weapon or not opts.sheet then
    wa.log("wfws_sprite_builder.flight: weapon and sheet are required")
    return
  end

  local main = resolve(opts)

  local bit_cfg = NATIVE
  if type(opts.bits) == "table" then
    bit_cfg = resolve(opts.bits)
  elseif opts.bits == "inherit" then
    bit_cfg = main
  end

  local extra = {}
  if type(opts.roles) == "table" then
    for i, r in ipairs(opts.roles) do
      extra[i] = { name = r.name or ("role" .. i), match = r.match, cfg = resolve(r) }
    end
  end

  local states = {}
  if type(opts.states) == "table" then
    for i, s in ipairs(opts.states) do
      states[i] = {
        scope = s.scope or "any",
        sigs = sigset(s.sig),
        when = s.when,
        cfg = s.native and NATIVE or resolve(s),
      }
    end
  end

  local owner = opts.owner

  local kind = {}        -- [id] = { ident = "main"|"bit"|role name, base = cfg }
  local sig = {}         -- [id] = last nonzero m.sprite seen (the state signal)
  local active = {}      -- [id] = cfg in force this frame
  local follow = {}      -- [id] = { actor, cfg, gen, seen }
  local spin_ang = {}
  local cycl_phase = {}
  local gen = 0

  -- Identity: first sight, before this module has zeroed m.sprite.
  local function classify(m)
    for i = 1, #extra do
      if extra[i].match(m) then return { ident = extra[i].name, base = extra[i].cfg } end
    end
    local is_bit
    if opts.is_bit then
      is_bit = opts.is_bit(m)
    else
      is_bit = (m.sprite ~= 0)
    end
    if is_bit then return { ident = "bit", base = bit_cfg } end
    return { ident = "main", base = main }
  end

  -- State: first matching state in scope, else the identity art.
  local function pick(m, ent)
    local s = sig[m.id]
    for i = 1, #states do
      local st = states[i]
      if st.scope == "any" or st.scope == ent.ident then
        if (st.sigs and s and st.sigs[s]) or (st.when and st.when(m)) then
          return st.cfg
        end
      end
    end
    return ent.base
  end

  local function gone(id, g)
    return function(b)
      local f = follow[id]
      if not f or f.gen ~= g then return end   -- stale actor from a state swap
      if f.seen then f.seen = false return end
      follow[id] = nil
      spin_ang[id] = nil
      cycl_phase[id] = nil
      kind[id] = nil
      sig[id] = nil
      active[id] = nil
      b:despawn()
    end
  end

  local function drop_follower(id)
    local f = follow[id]
    if f then
      follow[id] = nil
      f.actor:despawn()
    end
    cycl_phase[id] = nil
  end

  wa.on.missile_frame(function(m)
    if m.weapon ~= opts.weapon then return end
    local id = m.id

    local ent = kind[id]
    if ent == nil then
      ent = classify(m)
      kind[id] = ent
    end

    if m.phase == "pre" then
      if m.sprite ~= 0 then sig[id] = m.sprite end   -- read BEFORE zeroing
      local cfg = pick(m, ent)
      active[id] = cfg
      if cfg == NATIVE then
        -- Hand the sprite back. If our earlier zero stuck, restore the last
        -- signal (VERIFY: m.sprite is writable and WA draws it again).
        if m.sprite == 0 and sig[id] then m.sprite = sig[id] end
      else
        m.sprite = 0
      end
      return
    end

    local cfg = active[id]
    if cfg == nil then
      cfg = pick(m, ent)
      active[id] = cfg
    end
    if cfg == NATIVE then
      drop_follower(id)
      return
    end

    local f = follow[id]
    if f and f.cfg ~= cfg then            -- state changed: new art, new actor
      drop_follower(id)
      f = nil
    end
    if not f then
      gen = gen + 1
      f = {
        cfg = cfg, gen = gen,
        actor = wa.actors.spawn({
          sprite = cfg.sheet, x = m.x, y = m.y,
          gravity = false, collide = false,
          owner = owner or current_worm(), on = gone(id, gen),
        }),
      }
      follow[id] = f
    end
    f.seen = true
    local b = f.actor
    b.x, b.y, b.vx, b.vy = m.x, m.y, 0, 0

    local rot = 0
    if cfg.turn_fn then
      rot = cfg.turn_fn(m, spin_ang[id])
      spin_ang[id] = rot
    elseif cfg.anim_type == 2 then
      rot = M.track_angle(m.vx, m.vy)
    elseif cfg.anim_type == 3 then
      rot = M.rotation_turn(spin_ang[id], m.vx, m.vy, cfg.spin)
      spin_ang[id] = rot
    elseif cfg.anim_type == 1 then
      rot = M.spin_turn(spin_ang[id], m.vx, ANIM_SPEED[cfg.anim] or 0.5)
      spin_ang[id] = rot
    end

    local frame = 0
    if cfg.frame_fn then
      frame = cfg.frame_fn(m)
    elseif cfg.cyclical > 0 then
      frame, cycl_phase[id] = M.cyclical_frame(cycl_phase[id], cfg.anim_speed, cfg.cyclical)
    else
      cycl_phase[id] = nil
    end

    b.facing = cfg.mirror and (m.vx < 0 and -1 or 1) or 1
    b:frame(frame)
    b:gfx({ angle = math.deg(rot) % 360, depth = cfg.z, scale = cfg.scale })
  end)
end

M.PX_POSTURE = shared.PX_POSTURE
M.PX_HANDS = shared.PX_HANDS

return M
`;
