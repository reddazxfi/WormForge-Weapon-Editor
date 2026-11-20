"""Run the melee / swing half of `wfws_sprite_builder` against a fake `wa`.

The swing is simulation code: it only runs inside Worms Armageddon, so every
mistake in it (an early return, a gate that never opens, a handle that never
compares equal) costs a round trip into the game. This harness loads the real
SDK, builds a melee hold, presses Space and walks the clip, reporting what the
layer drew, what the strike hit and whether it released the worm.

    python -m pip install lupa
    python tools/lua/harness_melee.py            # exits 1 on a failure

It is a development aid, not part of `bun run lint` / `build`: `lupa` is not a
project dependency.
"""
import math
import os
import sys

from lupa import LuaRuntime

SDK = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'spec', 'lua_sdk', 'wfws_sdk', 'lib', 'wfws_sprite_builder.lua')

lua = LuaRuntime(unpack_returned_tuples=True)

# ---------------------------------------------------------------- the fake wa ---
WORLD = {"frame": 0, "keys": {"space": False}}
WORM = {
    "id": 1, "hp": 100, "turn": True, "visible": True, "body_visible": True,
    "weapon": "test.bat", "x": 1000, "y": 1000, "vx": 0, "vy": 0,
    "facing": 1, "aim": 0.5, "aim_target": 0.0, "state_id": 0x68, "state": "ready",
    "taken": False,
}
# `facing = 1` points the barrel right, so the worm it reaches stands at x + 24.
VICTIM = {
    "id": 2, "hp": 100, "turn": False, "visible": True, "body_visible": True,
    "weapon": "stock.grenade", "x": 1024, "y": 1000, "vx": 0, "vy": 0,
    "facing": -1, "aim": 0.5, "aim_target": 0.0, "state_id": 0x65, "state": "standing",
    "taken": False,
}
LOG = []
QUADS = []
EVENTS = []


def worm_record(w):
    t = lua.table()

    def take(_self, opts=None):
        freeze = opts is not None and opts["turn"] == "freeze"
        # `fire = true` is what lets a melee's ghost shot reach WA: a taken
        # worm's fire messages are the engine's to eat, so a take without it
        # swallowed the press and nothing was fired.
        fire = opts is not None and opts["fire"] == True
        w["taken"] = True
        EVENTS.append(("take", freeze, fire))
        return True

    def release(_self, vx=None, vy=None, opts=None):
        w["taken"] = False
        EVENTS.append(("release", vx, vy))
        return True

    def hurt(_self, opts=None):
        amount = opts["amount"] if opts is not None else 0
        vx = opts["vx"] if opts is not None and opts["vx"] is not None else 0.0
        vy = opts["vy"] if opts is not None and opts["vy"] is not None else 0.0
        w["hp"] -= amount or 0
        EVENTS.append(("hurt", w["id"], amount, float(vx), float(vy)))
        return True

    # `worm:input{ aim = degrees }` writes WA's own aim target (+0x24C), the
    # engine's `control_aim` value. Read-only fields stay read-only.
    def input_(_self, spec=None):
        aim = spec["aim"] if spec is not None else None
        if aim is None:
            raise ValueError("worm:input without aim in the harness")
        # The engine writes the worm's +0x24C, so the record the layer reads
        # changes; the dict keeps it across `step`'s per-frame copy.
        _self["aim_target"] = float(aim)
        w["aim_target"] = float(aim)
        EVENTS.append(("aim_input", w["id"], float(aim)))
        return True

    t.take = take
    t.release = release
    t.hurt = hurt
    t.input = input_
    for k, v in w.items():
        t[k] = v
    return t


WORMS = [WORM, VICTIM]
RECORDS = [worm_record(w) for w in WORMS]

# The engine hands out a *new* `WormHandle` userdata per `wa.worms.all()` call and
# defines no `__eq`, so two handles for one worm never compare equal. The harness
# has to model that, or it hides the very bug it exists to catch.
lua.execute("""
local records = ...
function fresh_worm(id)
  local rec = records[id]
  return setmetatable({}, {
    __index = function(_, k) return rec[k] end,
    __newindex = function(_, k, v) rec[k] = v end,
  })
end
""", {1: RECORDS[0], 2: RECORDS[1]})
FRESH = lua.globals()["fresh_worm"]


def all_worms():
    out = lua.table()
    for i, w in enumerate(WORMS, 1):
        out[i] = FRESH(w["id"])
    return out


wa = lua.table()
wa.log = lambda msg: LOG.append(str(msg))
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.world.keys = lambda: lua.table_from(WORLD["keys"])
wa.world.set_turn_clock = lambda ms: EVENTS.append(("turn_clock", ms))
wa.worms = lua.table()
wa.worms.all = all_worms
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.draw = lua.table()


def quad(*args):
    # `wa.draw.quad(table)`: one reused table carrying `sheet`, `points`, `blend`, …
    t = args[0]
    pts = t["points"]
    p1 = pts[1] if pts is not None else None
    QUADS.append({
        "sheet": t["sheet"],
        "blend": t["blend"],
        "tint": t["tint"],
        "x": p1["x"] if p1 is not None else None,
        "y": p1["y"] if p1 is not None else None,
    })


wa.draw.quad = quad
DRAW = []
MSG = []
BODY = []
wa.on = lua.table()
wa.on.draw = lambda fn: DRAW.append(fn)
wa.on.worm_message = lambda fn, opts=None: MSG.append(fn)
wa.on.body_move = lambda fn, opts=None: BODY.append(fn)
wa.weapons = lua.table()
wa.weapons.hold_sheet = lambda weapon, n: EVENTS.append(("mute", n))
wa.sound = lua.table()


def play_sound(target, sound, flags=None):
    # A numeric id is WA's own playback, a string is a pack WAV played by path;
    # the target is the emitter the voice is positioned at, the third argument
    # the voice priority.
    EVENTS.append(
        ("sound", sound, target["id"] if target is not None else None, flags)
    )
    return True


wa.sound.play = play_sound

lua.globals()["wa"] = wa

# `wf.sdk` is only needed for `holds.PX_HANDS`/`PX_POSTURE`; the spec names its
# sheets by hand here, so a stub is enough.
lua.execute("""
package.preload["wf-lib/holds"] = function()
  return { PX_HANDS = { [1] = "hand_rad.png", [2] = "hand_rad.png", [3] = "hand_rad_lower.png" } }
end
""")

sb = lua.execute('return assert(loadfile(%r))()' % SDK.replace("\\", "/"))

ctx = lua.table()
ctx.id = "test.bat"


def build_spec(weapon="test.bat", weap_rotation=1, aim_clamp=None, follow_swing=True,
               power=3, lift=1, hits=None, hit_sound=0, miss_sound=0,
               hit_wav=None, miss_wav=None, hit_priority=8, miss_priority=8,
               swing_angle=-30):
    spec = lua.table_from({
        "weapon": weapon,
        "sheet": "sprites/test.bat/hold.png",
        "silent_sheet": "sprites/test.bat/silent.png",
        "cell_size": 60,
        "hand_type": "mid",
        "weap_radius": 6,
        "weap_rotation": weap_rotation,
        "weap_radial_rotation": 1,
        "weap_scale": 1,
        "hand_radius": 10,
        "hand_rotation": 1,
        "hand_radial_rotation": 1,
        "draw_hand": True,
        "frames": 1,
        "swing": lua.table_from({
            "ticks": 16,
            "finish": "end_turn",
            "keys": lua.table_from([
                lua.table_from({"t": 0, "angle": 0, "dx": 0, "dy": 0, "scale": 1}),
                lua.table_from({"t": 8, "angle": swing_angle, "dx": 0, "dy": 0, "scale": 1}),
                lua.table_from({"t": 16, "angle": 0, "dx": 0, "dy": 0, "scale": 1}),
            ]),
        }),
        "melee": lua.table_from({
            "radius": 32, "width": 16, "follow_swing": follow_swing, "hit_frame": 8,
            "damage": 24,
            "push": "aim", "power": power, "lift": lift, "log": True,
        }),
    })
    if aim_clamp is not None:
        spec["aim_clamp"] = lua.table_from({"up": aim_clamp[0], "down": aim_clamp[1]})
    if hits is not None:
        spec["melee"]["hits"] = lua.table_from([
            lua.table_from({key: value for key, value in hit.items()}) for hit in hits
        ])
    spec["melee"]["hit_sound"] = hit_sound
    spec["melee"]["miss_sound"] = miss_sound
    spec["melee"]["hit_priority"] = hit_priority
    spec["melee"]["miss_priority"] = miss_priority
    if hit_wav is not None:
        spec["melee"]["hit_wav"] = hit_wav
    if miss_wav is not None:
        spec["melee"]["miss_wav"] = miss_wav

    # The claim's own hit callback, written the way the generator writes it:
    # `hit = function(victim, vx, vy) victim:hurt{ amount = 24, vx = vx, vy = vy } end`
    # The generator's shape: the strike that landed is the callback's fourth
    # argument, and the literal is only the fallback for a three-argument caller.
    spec["melee"]["hit"] = lua.execute(
        "return function(victim, vx, vy, hit) "
        "victim:hurt{ amount = hit and hit.damage or 24, vx = vx, vy = vy } end")
    return spec


hold = sb.hold(ctx, build_spec())
if hold is None:
    print("FAIL  M.hold returned nil")
    sys.exit(1)
print("layer registered: draw=%d message=%d" % (len(DRAW), len(MSG)))
if not DRAW or not MSG:
    print("FAIL  the layer never registered. log:", LOG)
    sys.exit(1)
draw_fn = DRAW[0]
msg_fn = MSG[0]


# WA's own aim control: 180/128 of a degree a frame while an aim key is held
# (`worm.aim_target`'s step, docs/agent/lua-worms.md), and the drawn `aim`
# +0x270 eased toward it. The harness snaps instead of easing, which is the
# strict version: a clamped target can never be drawn past.
AIM_STEP = 180.0 / 128.0


def native_aim(rec, w):
    keys = WORLD["keys"]
    if keys.get("aim_up") or keys.get("aim_down"):
        target = rec["aim_target"]
        if keys.get("aim_up"):
            target = min(90.0, target + AIM_STEP)
        else:
            target = max(-90.0, target - AIM_STEP)
        rec["aim_target"] = w["aim_target"] = target
        rec["aim"] = w["aim"] = max(0.0, min(1.0, (target + 90.0) / 180.0))
    else:
        # A test set `aim` by hand: WA's stored target follows what is drawn.
        rec["aim_target"] = w["aim_target"] = (rec["aim"] - 0.5) * 180.0


def step(n, space=False):
    """One 50 Hz frame: the bodies (body_move, then WA's own step for each), the
    frame-end messages, then the draw."""
    WORLD["frame"] = n
    WORLD["keys"]["space"] = space
    for i, rec in enumerate(RECORDS):
        for k, v in WORMS[i].items():
            rec[k] = v
    for fn in BODY:
        for w in WORMS:
            fn(FRESH(w["id"]))
    for i, w in enumerate(WORMS):
        native_aim(RECORDS[i], w)
    QUADS.clear()
    draw_fn()
    msg_fn(all_worms()[1], wa.msg.FRAME_FINISH)
    draw_fn()


failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  " + detail) if detail else ""))
    if not ok:
        failures.append(name)


# Aiming, no press: the layer draws the held art and mutes the engine sheet.
step(1)
check("aiming draws the hold", len(QUADS) > 0, "%d quad(s)" % len(QUADS))
check("engine sheet muted while drawing", ("mute", 1) in EVENTS)

# Space: the swing takes the worm on the same frame and starts drawing.
step(2, space=True)
check("Space takes the worm", ("take", True, True) in EVENTS)
check("the press frame draws the swing", len(QUADS) > 0, "%d quad(s)" % len(QUADS))

# Hold Space for the whole clip: WA would repeat the key, but the swing ignores it.
for n in range(3, 12):
    step(n, space=True)
check("the strike dealt damage", VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
check("the strike pushed through the callback",
      any(e[0] == "hurt" and e[1] == 2 and e[2] == 24 for e in EVENTS),
      str([e for e in EVENTS if e[0] == "hurt"][:2]))
check("inside the box, one hit only", len([e for e in EVENTS if e[0] == "hurt"]) == 1)
check("no second take while swinging", len([e for e in EVENTS if e[0] == "take"]) == 1)

for n in range(12, 20):
    step(n, space=True)
check("the clip releases the worm", ("release", 0, 0) in EVENTS)
check("finish = end_turn ends the turn", ("turn_clock", 0) in EVENTS)
check("one take, one release",
      len([e for e in EVENTS if e[0] == "release"]) == 1,
      str([e for e in EVENTS if e[0] in ("take", "release")]))

# A taken worm is not guaranteed to keep WA's aim state, and the clip must not
# depend on it: the swing is its own clock, so the art keeps drawing with the
# worm in a plain standing state.
EVENTS.clear()
WORM["state_id"] = 0x65
step(50)
step(51, space=True)
check("a press starts the swing in a non-aim state", ("take", True, True) in EVENTS)
draws = 0
for n in range(52, 60):
    step(n, space=True)
    draws += len(QUADS)
check("the clip draws without an aim state", draws > 0, "%d quad(s) over 8 frames" % draws)
for n in range(60, 68):
    step(n, space=True)
check("the clip still ends in a non-aim state", ("release", 0, 0) in EVENTS)
WORM["state_id"] = 0x68

# WA may stop reporting our weapon during the clip (the worm is taken, its
# selection can drift). The swing is its own clock, so it must still draw and
# still land its hit.
EVENTS.clear()
VICTIM["x"] = 1024
VICTIM["hp"] = 100
step(80)
step(81, space=True)
WORM["weapon"] = "stock.grenade"
draws = 0
for n in range(82, 90):
    step(n, space=True)
    draws += len(QUADS)
check("the clip draws after the selection drifts", draws > 0, "%d quad(s)" % draws)
check("the strike still lands after the drift", VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
for n in range(90, 100):
    step(n, space=True)
check("the clip still ends after the drift", ("release", 0, 0) in EVENTS)
WORM["weapon"] = "test.bat"

# A sheet turned 40 degrees is still the same weapon: `weap_rotation` is a drawing
# control and must not turn the box.
rot_ctx = lua.table()
rot_ctx.id = "test.bat.rot"
sb.hold(rot_ctx, build_spec("test.bat.rot", 1 + 40 / 180))
EVENTS.clear()
WORM["weapon"] = "test.bat.rot"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
VICTIM["hp"] = 100
step(60)
step(61, space=True)
for n in range(62, 78):
    step(n, space=True)
check(
    "a turned sheet does not turn the box",
    VICTIM["hp"] < 100,
    "victim hp %d (weap_rotation must be a drawing control only)" % VICTIM["hp"],
)
WORM["weapon"] = "test.bat"

# The box follows the aim: down when the worm aims down,
# up when it aims up, and forward at a level aim with a POSITIVE `weap_radius`.
# (Reading "forward" off `weap_radius` inverted the box for every positive
# radius, so a strike only landed on whatever the worm had its back to.)
for aim, dx, dy, label in (
    (0.5, 24, 0, "forward at a level aim"),
    (0.0, 0, 26, "down when the worm aims down"),
    (1.0, 0, -26, "up when the worm aims up"),
):
    EVENTS.clear()
    WORM["aim"] = aim
    VICTIM["x"], VICTIM["y"] = 1000 + dx, 1000 + dy
    VICTIM["hp"] = 100
    step(110)
    step(111, space=True)
    for n in range(112, 128):
        step(n, space=True)
    check("the box points " + label, VICTIM["hp"] < 100, "victim hp %d" % VICTIM["hp"])
WORM["aim"] = 0.5
VICTIM["y"] = 1000

# The two culls that are not distance (WF 59): behind the striker, and outside
# the arc. `along` is the distance projected on the aim, so a worm behind has a
# negative one, and `across` is the distance off the line, which `width` bounds.
for dx, dy, label in ((-24, 0, "a worm behind the striker"), (24, 40, "a worm outside the arc")):
    EVENTS.clear()
    WORM["weapon"] = "test.bat"
    WORM["aim"] = 0.5
    VICTIM["x"], VICTIM["y"] = 1000 + dx, 1000 + dy
    VICTIM["hp"] = 100
    step(160 if dx < 0 else 190)
    step(161 if dx < 0 else 191, space=True)
    for n in range(162 if dx < 0 else 192, 178 if dx < 0 else 208):
        step(n, space=True)
    check(
        "%s is not hit" % label,
        VICTIM["hp"] == 100,
        "victim hp %d (along/across culled it)" % VICTIM["hp"],
    )
VICTIM["x"], VICTIM["y"] = 1024, 1000

# A swing that misses: the victim leaves the box, and the press still plays.
EVENTS.clear()
VICTIM["x"] = 1400
step(30)
step(31, space=True)
for n in range(32, 48):
    step(n, space=True)
check("a miss still runs the whole clip", ("take", True, True) in EVENTS and ("release", 0, 0) in EVENTS)
check("a miss deals no damage", not [e for e in EVENTS if e[0] == "hurt"])

# The "Space did nothing" line is only for our own weapon. A press while the
# turn's worm holds somebody else's stock weapon belongs to that weapon (a jump,
# a backflip, a rifle) and must stay out of the log: one WFWS weapon installed
# would otherwise fill the game log of every player in the match.
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "stock.rifle"
step(200)
step(201, space=True)
for n in range(202, 206):
    step(n, space=True)
check(
    "a press on a stock weapon logs nothing",
    not [line for line in LOG if line.startswith("[wfws] Space pressed")],
    "; ".join(LOG) or "no lines",
)

# Holding one of our weapons that has no clip is exactly the case the line is
# for: the layer exists, and it has no swing to start.
noclip = lua.table()
noclip.id = "test.bat.noclip"
spec_noclip = build_spec("test.bat.noclip")
spec_noclip["swing"] = None
sb.hold(noclip, spec_noclip)
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat.noclip"
step(300)
step(301, space=True)
for n in range(302, 306):
    step(n, space=True)
check(
    "a press on our weapon with no clip says so",
    any(line.startswith("[wfws] Space pressed") for line in LOG),
    "; ".join(LOG) or "no lines",
)
WORM["weapon"] = "test.bat"

# The aim clamp (`aim_clamp`): the pose and the strike stop that many degrees
# either side of level, so a vertical aim cannot be swung from. 45/45 puts the
# limit at aim 0.25 and 0.75, which is what the victim positions below use.
clamp_ctx = lua.table()
clamp_ctx.id = "test.bat.clamp"
clamp_rust = sb.hold(clamp_ctx, build_spec("test.bat.clamp", 1, (45, 45)))
check(
    "the clamp parks the engine hand",
    abs(float(clamp_rust.hand_radius) - 0.01) < 1e-9,
    "hand_radius %s (the layer draws the clamped hand, so the engine's must hide)"
    % clamp_rust.hand_radius,
)

# Aimed 26 px straight down with a 45 degree limit: the strike goes along the
# clamped 45 (down and forward), not straight down, so a worm straight below is
# out of the box.
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat.clamp"
WORM["aim"] = 0.0
VICTIM["x"], VICTIM["y"] = 1000, 1026
VICTIM["hp"] = 100
step(400)
step(401, space=True)
for n in range(402, 418):
    step(n, space=True)
check(
    "a vertical aim is clamped for the strike",
    VICTIM["hp"] == 100,
    "victim hp %d (a worm straight below is outside a 45 degree clamp)" % VICTIM["hp"],
)
check(
    "the clamp is reported in the log",
    any("aim clamped" in line for line in LOG),
    "; ".join(line for line in LOG if "clamp" in line) or "no clamp line",
)

# What a hit throws is the aim vector, not the art: `push = "aim"` is the scan
# vector times `power`, minus `lift` on y. Two straight-line cases with the swing
# rotation off, so the numbers are the aim alone.
def strike_at(weapon, aim, victim_at, spec_kwargs, tick):
    """Run one swing from `aim` and return the (vx, vy) the victim was thrown by."""
    EVENTS.clear()
    WORM["weapon"] = weapon
    WORM["aim"] = aim
    VICTIM["x"], VICTIM["y"] = victim_at
    VICTIM["hp"] = 100
    WORLD["keys"]["aim_up"] = False
    WORLD["keys"]["aim_down"] = False
    step(tick)
    step(tick + 1, space=True)
    for n in range(tick + 2, tick + 18):
        step(n, space=True)
    for event in EVENTS:
        if event[0] == "hurt" and event[1] == VICTIM["id"]:
            return event[3], event[4]
    return None


straight_ctx = lua.table()
straight_ctx.id = "test.bat.straight"
sb.hold(straight_ctx, build_spec("test.bat.straight", 1, None, follow_swing=False, power=3, lift=1))
level = strike_at("test.bat.straight", 0.5, (1024, 1000), {}, 800)
check(
    "a level strike throws along the aim",
    level is not None and abs(level[0] - 3.0) < 1e-6 and abs(level[1] + 1.0) < 1e-6,
    "throw %s (level aim: x = power, y = -lift)" % (level,),
)
down = strike_at("test.bat.straight", 0.0, (1000, 1024), {}, 850)
check(
    "a straight-down strike has no side push",
    down is not None and abs(down[0]) < 1e-9 and abs(down[1] - 2.0) < 1e-6,
    "throw %s (straight down: x = 0 even though it is the zero case, y = power - lift)"
    % (down,),
)

# A combo: three strikes on their own ticks, each with its own damage and throw.
combo_ctx = lua.table()
combo_ctx.id = "test.bat.combo"
COMBO = [
    {"frame": 4, "damage": 7, "power": 1, "lift": 0},
    {"frame": 8, "damage": 9, "power": 3, "lift": 1},
    {"frame": 12, "damage": 11, "power": 5, "lift": 2},
]
sb.hold(combo_ctx, build_spec("test.bat.combo", 1, None, follow_swing=False, hits=COMBO,
                             hit_sound=96, miss_sound=96, hit_priority=10))
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat.combo"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
VICTIM["hp"] = 100
step(900)
step(901, space=True)
for n in range(902, 920):
    step(n, space=True)
hurt = [e for e in EVENTS if e[0] == "hurt" and e[1] == VICTIM["id"]]
check(
    "a combo lands every strike",
    len(hurt) == 3,
    "%d hit(s): %s" % (len(hurt), [h[2] for h in hurt]),
)
check(
    "each strike brings its own damage",
    [h[2] for h in hurt] == [7, 9, 11],
    "damage %s" % ([h[2] for h in hurt],),
)
check(
    "and its own throw",
    [round(h[3], 3) for h in hurt] == [1.0, 3.0, 5.0],
    "vx %s (power 1, 3, 5 along a level aim)" % ([round(h[3], 3) for h in hurt],),
)
check(
    "and its own lift",
    [round(h[4], 3) for h in hurt] == [0.0, -1.0, -2.0],
    "vy %s (lift subtracted from a level aim's zero)" % ([round(h[4], 3) for h in hurt],),
)
check(
    "a combo is logged strike by strike",
    sum(1 for line in LOG if "hit " in line and " at frame" in line) >= 3,
    "; ".join(line for line in LOG if " at frame" in line) or "no per-strike lines",
)

combo_sounds = [e for e in EVENTS if e[0] == "sound"]
check(
    "each landed strike plays the hit sound once",
    [e[1] for e in combo_sounds] == [96, 96, 96] and all(e[2] == VICTIM["id"] for e in combo_sounds),
    "%d play(s) at %s (one per strike, at the worm it took)"
    % (len(combo_sounds), [e[2] for e in combo_sounds]),
)

# A weapon that uploaded its own WAV: the path plays instead of the id, with its
# own priority (the file wins, like `fire_draw` over `draw_hand`).
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
wav_ctx = lua.table()
# The same weapon, so the sampler finds it: a second entry under another name is
# never asked for, since the worm's weapon is the key.
sb.hold(wav_ctx, build_spec("test.bat", 1, None, follow_swing=False, hits=COMBO,
                            hit_sound=96, miss_sound=96,
                            hit_wav="sounds/test/melee_hit.wav",
                            miss_wav="sounds/test/melee_miss.wav",
                            hit_priority=16, miss_priority=4))
step(920)
step(921, space=True)
for n in range(922, 948):
    step(n, space=True)
wav_plays = [e for e in EVENTS if e[0] == "sound"]
check(
    "an uploaded WAV plays instead of the native id",
    [e[1] for e in wav_plays] == ["sounds/test/melee_hit.wav"] * 3
    and all(e[3] == 16 for e in wav_plays),
    "%s" % (wav_plays,),
)

# A strike can name its own sample (`sound` / `wav` / `priority` on the row), so a
# combo opens light and ends heavy while the rows that name none keep playing the
# weapon's own hit sound.
mixed_ctx = lua.table()
mixed_ctx.id = "test.bat.mixed"
MIXED = [
    {"frame": 4, "damage": 7, "power": 1, "lift": 0},
    {"frame": 8, "damage": 9, "power": 3, "lift": 1, "sound": 8},
    {
        "frame": 12,
        "damage": 11,
        "power": 5,
        "lift": 2,
        "wav": "sounds/test/melee_hit3.wav",
        "priority": 16,
    },
]
sb.hold(mixed_ctx, build_spec("test.bat.mixed", 1, None, follow_swing=False, hits=MIXED,
                             hit_sound=96, miss_sound=96, hit_priority=10))
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat.mixed"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
VICTIM["hp"] = 100
step(960)
step(961, space=True)
for n in range(962, 980):
    step(n, space=True)
mixed_plays = [e for e in EVENTS if e[0] == "sound"]
check(
    "a strike with its own sample plays that one",
    [e[1] for e in mixed_plays]
    == [96, 8, "sounds/test/melee_hit3.wav"],
    "%s (the rows with none fall back to the weapon's hit sound)" % (mixed_plays,),
)
check(
    "and the row priority wins over the weapon's",
    [e[3] for e in mixed_plays] == [10, 8, 16],
    "priorities %s" % ([e[3] for e in mixed_plays],),
)

# `follow_swing`: the clip's angle at the hit frame turns the box, so a cut that
# rises reaches a worm overhead that the level aim cannot. The same spec twice,
# once with the flag and once without, and the victim above and in front.
for follow, label in ((True, "with follow_swing"), (False, "without it")):
    name = "test.bat.follow%d" % (1 if follow else 0)
    follow_ctx = lua.table()
    follow_ctx.id = name
    sb.hold(follow_ctx, build_spec(name, 1, None, follow_swing=follow, swing_angle=-55))
    EVENTS.clear()
    LOG.clear()
    WORM["weapon"] = name
    WORM["aim"] = 0.5
    # 12 px ahead and 24 px up: inside the 32 px reach and the 16 px arc once the
    # box has turned 55 degrees, outside it when the box stays level.
    VICTIM["x"], VICTIM["y"] = 1012, 976
    VICTIM["hp"] = 100
    step(900 if follow else 940)
    step(901 if follow else 941, space=True)
    for n in range(902 if follow else 942, 918 if follow else 958):
        step(n, space=True)
    damaged = VICTIM["hp"] < 100
    check(
        "an overhead worm is hit %s" % label,
        damaged == follow,
        "victim hp %d (the box %s the clip angle)"
        % (VICTIM["hp"], "follows" if follow else "ignores"),
    )
VICTIM["x"], VICTIM["y"] = 1024, 1000

# A swing into thin air: the same weapon, nobody in the box, so every strike
# plays the whiff at the striker instead. The id-sound combo entry answers again
# (two entries under one weapon would both swing).
EVENTS.clear()
LOG.clear()
WORM["weapon"] = "test.bat.combo"
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 2000, 2000
step(880)
step(881, space=True)
for n in range(882, 908):
    step(n, space=True)
whiffs = [e for e in EVENTS if e[0] == "sound"]
check(
    "a strike that takes nobody plays the whiff at the striker",
    len(whiffs) == 3 and all(e[1] == 96 and e[2] == WORM["id"] for e in whiffs),
    "%d play(s): %s" % (len(whiffs), whiffs),
)
check(
    "the whiff keeps the weapon's own priority",
    all(e[3] == 8 for e in whiffs),
    "%s" % ([e[3] for e in whiffs],),
)
VICTIM["x"], VICTIM["y"] = 1024, 1000

# Each strike tests the box at its own frame, so a worm that leaves after the
# first one is not hit by the rest: the combo is not a single damage packet.
EVENTS.clear()
LOG.clear()
VICTIM["hp"] = 100
WORMS[1]["y"] = 1000
WORM["aim"] = 0.5
step(950)
step(951, space=True)
moved = False
for n in range(952, 968):
    if n == 958:
        # Out of the box, and out of reach: y is a hundred pixels off the line.
        WORMS[1]["y"] = 1100
        moved = True
    step(n, space=True)
hurt = [e for e in EVENTS if e[0] == "hurt" and e[1] == VICTIM["id"]]
check(
    "a strike tests the box at its own frame",
    moved and [h[2] for h in hurt] == [7],
    "damage %s (strike 1 landed, 2 and 3 had nobody to hit)" % ([h[2] for h in hurt],),
)
WORMS[1]["y"] = 1000
WORM["weapon"] = "test.bat"

# The native half: `worm:input{ aim = deg }` writes WA's own aim target, so the
# shot is inside the limit too, not only the draw. Hold the aim key and let WA
# step the target 180/128 degrees a frame: it must stall at the limit (one native
# step past it at most), not run on to straight up.
EVENTS.clear()
LOG.clear()
WORM["aim"] = 0.5
WORM["aim_target"] = 0.0
WORM["weapon"] = "test.bat.clamp"
WORLD["keys"]["aim_up"] = True
WORLD["keys"]["aim_down"] = False
for n in range(600, 660):
    step(n)
WORLD["keys"]["aim_up"] = False
writes = [e for e in EVENTS if e[0] == "aim_input"]
worst = max((e[2] for e in writes), default=None)
check(
    "the native aim is clamped, not only the draw",
    worst is not None and worst <= 45.0 + 1e-9,
    "worst native aim write %s, WA's target now %s"
    % (worst, RECORDS[0]["aim_target"]),
)
check(
    "the target stalls at the limit instead of reaching straight up",
    45.0 - 1e-6 <= RECORDS[0]["aim_target"] <= 45.0 + AIM_STEP + 1e-6,
    "target %.3f after 60 frames of held aim (limit 45, step %.3f)"
    % (RECORDS[0]["aim_target"], AIM_STEP),
)
check(
    "the drawn aim follows the clamped target",
    abs(RECORDS[0]["aim"] - (0.5 + 45.0 / 180.0)) < 0.01,
    "drawn aim %.3f, clamped 0.750" % RECORDS[0]["aim"],
)

# Without the clamp the same input runs to the top of WA's sweep: the check above
# means nothing if the harness cannot reach it.
WORLD["keys"]["aim_up"] = True
for n in range(700, 780):
    step(n)
WORLD["keys"]["aim_up"] = False
unclamped = RECORDS[1]["aim_target"]  # the victim's weapon has no aim_clamp
check(
    "an unclamped weapon still reaches straight up",
    unclamped > 45.0,
    "target %.3f (the harness itself can reach the top)" % unclamped,
)

# The same clamp aimed level still strikes the worm in front, at the aim pose's
# own 45 degree clip angle.
EVENTS.clear()
LOG.clear()
WORM["aim"] = 0.5
VICTIM["x"], VICTIM["y"] = 1024, 1000
VICTIM["hp"] = 100
step(500)
step(501, space=True)
for n in range(502, 518):
    step(n, space=True)
check(
    "a level aim still lands inside the clamp",
    VICTIM["hp"] < 100,
    "victim hp %d (the clamp must not narrow the ordinary swing)" % VICTIM["hp"],
)
WORM["weapon"] = "test.bat"
WORM["aim"] = 0.5

print()
for line in LOG:
    print("  log:", line)
print()
if failures:
    print("FAILED: " + ", ".join(failures))
    sys.exit(1)
print("all checks passed")
