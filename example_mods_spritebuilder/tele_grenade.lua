-- Tele Grenade: PX's record. Its ExplodeAt skips WA's blast and warps the
-- throwing worm to the impact, scanning a 9x9 box right and down if the first
-- spot is blocked.
local pyro = require("lib/pyro")

local M = {}

local shooter

local function teleport(w, x, y)
  if not w then return end
  if w:fits(x, y) then
    w:warp({ x = x, y = y })
    return
  end
  local limit = 9
  local tx, ty = x - math.floor(limit / 2), y - math.floor(limit / 2)
  local col = 0
  local row = 0
  while true do
    if w:fits(tx, ty) then
      w:warp({ x = tx, y = ty })
      return
    end
    if row <= limit then
      tx = tx + 1
      row = row + 1
    elseif col <= limit then
      ty = ty + 1
      col = col + 1
      tx = x - math.floor(limit / 2)
      row = 0
    else
      return
    end
  end
end

local function on_explode(ev)
  pyro.drop(ev.missile)
  local w = ev.worm or shooter or pyro.current_worm()
  pyro.sound(w, 67)
  teleport(w, ev.x, ev.y)
end

function M.install(ctx)
  if not pyro.replace(ctx, {
    name = "Tele Grenade",
    art = "tele",
    icon = "tele",
    wep = "Tele_Grenade_WEP.wep",
    anim = 1,
    hold = { hand_radius = 20.0, hand_rotation = 1.0,
      hand_radial_rotation = 1.05, weap_radial_rotation = 0.9,
      weap_rotation = 0.5, weap_radius = 10.0, hand_type = 1,
      hand_scale = 0.8 },
    -- PX's Tele Grenade ExplodeAt never calls super: no native blast.
    missile = { explosion = { power = 0, push_pct = 0 } },
    on_explode = on_explode,
  }) then return end

  wa.on.worm_message(function(worm, msg)
    if msg == wa.msg.FIRE_WEAPON and worm.weapon == ctx.id then
      shooter = worm
    end
  end, { msgs = { wa.msg.FIRE_WEAPON } })
end

return M
