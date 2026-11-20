"""Run the flight half of `wfws_sprite_builder` against a fake `wa`.

The flight handler only runs inside Worms Armageddon, and the mistakes that cost
a round trip are the quiet ones: a table that is never freed, an identity that
is not re-decided, a frag that is not recognised as a frag. This harness loads
the real SDK, drives `missile_frame` for both WA phases over a run of 50 Hz
frames, and reports what the builder classified and what it spawned.

    python -m pip install lupa
    python tools/lua/harness_flight.py           # exits 1 on a failure

It covers the two findings of `reqs/audit_wfws_sprite_builder_2026-11-16.md`
that changed SDK behaviour:

  - A2: a missile that never gets a follower (a walking animal WA draws itself)
    is swept after a second, so its per-missile entries cannot outlive the
    match. The one-frame cost of that is one fresh classification.
  - B11: `bits = "inherit"` keeps the primary's art but still classifies a frag
    as a bit, which is what an effect's `target` reads.

It also pins the bit identity the old `m.sprite` test got wrong: a round that
carries the cluster sprite (the banana cluster case) is a round, its burst's
missiles are bits, a fire-sequence round stays a round, and `bit_window` /
`bit_radius` are honoured.

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
# The worms `wa.worms.all()` lists; the one with `turn` is the follower's owner.
# Empty is a real state: a worm that has lost control is still flying its shot.
WORMS = []
LOG = []
SPAWNS = []
LOOKS = []      # (actor, sheet) for every `a:look`
DESPAWNS = []   # every actor despawned
CALLS = {}
FRAMES = []

wa = lua.table()
wa.log = lambda msg: LOG.append(str(msg))
wa.msg = lua.table()
wa.msg.FRAME_FINISH = 40
wa.world = lua.table()
wa.world.frame = lambda: WORLD["frame"]
wa.world.keys = lambda: lua.table_from(WORLD["keys"])
wa.worms = lua.table()
wa.worms.all = lambda: lua.table_from([lua.table_from(w) for w in WORMS])
wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
# The engine's `wa.math.atan(y, x)` is atan2 (the builder's track angle calls
# it with the velocity pair); Python's `math.atan` takes one argument.
wa.math.atan = lambda y, x: math.atan2(y, x)
wa.draw = lua.table()
wa.draw.quad = lambda *a: None
wa.on = lua.table()
wa.on.missile_frame = lambda fn: FRAMES.append(fn)
wa.on.draw = lambda fn: None
wa.on.worm_message = lambda fn, opts=None: None
wa.on.body_move = lambda fn, opts=None: None
wa.weapons = lua.table()
wa.weapons.hold_sheet = lambda weapon, n: None


def spawn(spec):
    # A follower actor: `sb.flight` writes `.x/.y/.vx/.vy/.facing` and calls
    # `frame`, `gfx` and `despawn` on it. A missile frame has no worm of its
    # own, so the engine refuses a spawn that names no owner, as here.
    if spec["owner"] is None:
        raise RuntimeError("spawn needs an owner worm or actor")
    SPAWNS.append(spec)
    actor = lua.table()
    for name in ("frame", "gfx", "sound"):
        actor[name] = lambda *a: None
    actor["look"] = lambda self, sheet: LOOKS.append((self, sheet))
    actor["despawn"] = lambda self: DESPAWNS.append(self)
    return actor


wa.actors = lua.table()
wa.actors.spawn = spawn
lua.globals()["wa"] = wa

# `wf.sdk` only supplies the hold sheets, which this half never names.
lua.execute(
    'package.preload["wf-lib/holds"] = function() return { PX_HANDS = {}, PX_POSTURE = {} } end'
)
sb = lua.execute('return assert(loadfile(%r))()' % SDK.replace("\\", "/"))


# ------------------------------------------------------------------- helpers ---
def counter(m):
    """`is_bit` counts classifications: identity is decided once per missile."""
    CALLS[m["id"]] = CALLS.get(m["id"], 0) + 1
    return False


def missile(mid, sprite, weapon, x=1000.0, y=1000.0):
    m = lua.table()
    m.id = mid
    m.weapon = weapon
    m.sprite = sprite
    m.x, m.y, m.vx, m.vy = x, y, 0.0, 0.0
    m.phase = "pre"
    m.despawn = lambda *a: None
    return m


def call(mid, sprite, weapon, x=1000.0, y=1000.0):
    """Both phases of the current frame, without advancing the clock."""
    for phase in ("pre", "post"):
        for fn in FRAMES:
            m = missile(mid, sprite, weapon, x, y)
            m.phase = phase
            fn(m)


def step(mid, sprite, weapon, x=1000.0, y=1000.0):
    """One 50 Hz frame: WA delivers the missile to both its phases."""
    WORLD["frame"] += 1
    call(mid, sprite, weapon, x, y)


def advance(n=1):
    """A frame with no missile in it (the gap between two turns)."""
    WORLD["frame"] += n


def bits_table():
    return lua.table_from({"sheet": "sprites/test/bit.png", "anim": "track"})


def flight(weapon, track=True, **opts):
    spec = lua.table_from({"weapon": weapon, "sheet": "sprites/test/missile.png"})
    if track:
        spec["is_bit"] = counter
    for key, value in opts.items():
        spec[key] = value
    sb.flight(None, spec)


fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + ("" if ok or not detail else f"  [{detail}]"))
    if not ok:
        fails += 1


# ---- A2: a missile with no follower is swept, one with a follower is not -----
# A roaming animal WA walks itself: `walk = 900` is its record sprite, so the
# builder hands the art back every pre frame and never makes a follower.
flight("test.roam", roam=lua.table_from({"walk": 900}))
for _ in range(60):
    step(7, 900, "test.roam")
check("the walking animal is classified once", CALLS.get(7) == 1, str(CALLS.get(7)))
check("WA keeps its own walk pose: no follower", len(SPAWNS) == 0, str(len(SPAWNS)))
check("its role is answered while WA draws it", sb.role(7) == "main", repr(sb.role(7)))

# A round a second later is when the sweep is due, and it is the only thing that
# can free a missile the follower never owned.
step(8, 900, "test.roam")
check("the newcomer is classified", CALLS.get(8) == 1, str(CALLS.get(8)))
step(7, 900, "test.roam")
check(
    "the second-old entry with no follower was swept and re-classified",
    CALLS.get(7) == 2,
    f"{CALLS.get(7)} classifications",
)
check("and it is still the main role", sb.role(7) == "main", repr(sb.role(7)))
check("the sweep spawned nothing", len(SPAWNS) == 0, str(len(SPAWNS)))

# A normal round: the follower owns this state, so the sweep must leave it alone
# however old the id is.
flight("test.plain")
for _ in range(3):
    step(9, 0, "test.plain")
check("a drawn round gets its follower", len(SPAWNS) == 1, str(len(SPAWNS)))
check("and is classified once", CALLS.get(9) == 1, str(CALLS.get(9)))
step(10, 0, "test.plain")
step(9, 0, "test.plain")
check(
    "a round with a follower is never swept, however old",
    CALLS.get(9) == 1,
    f"{CALLS.get(9)} classifications",
)
check("its role is still answered", sb.role(9) == "main", repr(sb.role(9)))

# ---- B11: `bits = "inherit"` keeps the art but not the identity --------------
# The generator never writes `inherit`; a hand-written bundle does, and a trail
# or burst with `target = "bit"` reads this answer. Identity is timing now: the
# first missile is the round, the one built by its burst is a bit.
flight("test.inherit", track=False, bits="inherit")
step(11, 500, "test.inherit")
check("the first missile of an inheriting weapon is the round", sb.role(11) == "main", repr(sb.role(11)))
step(12, 500, "test.inherit")
check("the missile built by its burst is a bit", sb.role(12) == "bit", repr(sb.role(12)))

flight("test.nobits", track=False)
step(13, 500, "test.nobits")
check(
    "and a round of a plain weapon is still the round",
    sb.role(13) == "main",
    repr(sb.role(13)),
)

# ---- The banana cluster regression -----------------------------------------
# WA can put the cluster sprite in the round's render slot (`clustlet`): the
# main missile of a cluster record came out with a nonzero `m.sprite` and was
# classified as a bit, while its bits carried 0 and were called rounds. Timing
# must get both right without reading the sprite at all.
flight("test.cluster", track=False, bits=bits_table())
step(20, 54, "test.cluster")          # the round, carrying clustlet's id
check("a round carrying the cluster sprite is still the round", sb.role(20) == "main", repr(sb.role(20)))
step(21, 0, "test.cluster")           # the burst
step(22, 0, "test.cluster")
check("the frags built by its burst are bits", sb.role(21) == "bit" and sb.role(22) == "bit", f"{sb.role(21)}, {sb.role(22)}")
# A later turn is far outside the burst window, so its shot is a round again.
advance(10)
step(23, 54, "test.cluster")
check("a shot after the burst window is a new round", sb.role(23) == "main", repr(sb.role(23)))

# The engine can build the burst on the frame the round was last seen and list
# the new bits before it drops the round. That same-frame sighting is still a
# bit because it is at the round's position; a shot from the muzzle is not.
flight("test.same", track=False, bits=bits_table())
WORLD["frame"] += 1
call(60, 54, "test.same", 1000, 1000)
call(61, 0, "test.same", 1000, 1000)
# The same-frame sighting is ambiguous, so it is decided next frame, when the
# round is gone.
WORLD["frame"] += 1
call(61, 0, "test.same", 1000, 1000)
check("a burst on the round's own frame is a bit", sb.role(61) == "bit", repr(sb.role(61)))
call(62, 54, "test.same", 500, 500)
check("a shot from the muzzle on that frame is a round", sb.role(62) == "main", repr(sb.role(62)))

# A fire sequence fires a second round while the first is still in the air.
# That is a round, not a frag, even when both are seen on the same frame; the
# ambiguous frame is decided when the first round is still alive.
flight("test.seq", track=False, bits=bits_table())
WORLD["frame"] += 1
call(30, 54, "test.seq")
call(31, 54, "test.seq")
WORLD["frame"] += 1
call(30, 54, "test.seq")
call(31, 54, "test.seq")
check("a second shot while the round is alive is a round", sb.role(31) == "main", repr(sb.role(31)))
step(32, 0, "test.seq")
check("and only the burst's missiles are bits", sb.role(32) == "bit", repr(sb.role(32)))

# The burst is at the round's position; a shot leaves the muzzle. A new round
# that appears inside the burst window but far from the dead round is a round,
# which keeps a fire sequence of cluster rounds apart.
flight("test.place", track=False, bits=bits_table())
step(50, 54, "test.place", 1000, 1000)
step(51, 0, "test.place", 1032, 1000)
check("a frag at the round's position is a bit", sb.role(51) == "bit", repr(sb.role(51)))
step(52, 54, "test.place", 500, 500)
check("a shot far from the dead round is a round", sb.role(52) == "main", repr(sb.role(52)))

# A window of zero is the exact burst frame only; the harness's step gives the
# bits one frame of slack, so use a weapon with `bit_window = 1` to prove the
# option is read, then a far shot stays a round.
flight("test.window", track=False, bits=bits_table(), bit_window=1)
step(40, 54, "test.window")
step(41, 0, "test.window")
check("bit_window = 1 still catches the burst", sb.role(41) == "bit", repr(sb.role(41)))
advance(4)
step(42, 54, "test.window")
check("bit_window = 1 ends before the next shot", sb.role(42) == "main", repr(sb.role(42)))

# ---- Owner: the follower is spawned when no worm has the turn ---------------
# A worm that lost control leaves no turn worm while its shot is in the air. The
# spawn used to fail every frame there, with WA's sprite already hidden, so the
# round flew with no art at all.
WORMS.clear()
flight("test.owner", track=False)
before = len(SPAWNS)
step(70, 0, "test.owner")
check("with no turn worm the follower is still spawned", len(SPAWNS) == before + 1, str(len(SPAWNS) - before))
check("and is no team's", len(SPAWNS) > before and SPAWNS[-1]["owner"] == "none", repr(SPAWNS[-1]["owner"]) if len(SPAWNS) > before else "none spawned")
WORMS.append({"id": 3, "turn": True})
step(71, 0, "test.owner", 400, 400)
check("with a turn worm it is that worm's", SPAWNS[-1]["owner"] is not None and SPAWNS[-1]["owner"]["id"] == 3, repr(SPAWNS[-1]["owner"]))
WORMS.clear()

# ---- The deferred frame does not show WA's stock sprite ----------------------
# A burst listed on the round's own frame is decided a frame later. WA draws
# `m.sprite` in between, which showed its stock clustlet (54) for one frame at
# every split. The builder hides it during the wait and keeps it as the signal.
flight("test.flash", track=False, bits=bits_table())
WORLD["frame"] += 1
call(80, 54, "test.flash", 1000, 1000)
# One missile across both phases: `m.sprite` is the missile's own field in WA,
# so a write in one phase is what WA draws after the frame.
bit = missile(81, 54, "test.flash", 1000, 1000)
for phase in ("pre", "post"):
    bit.phase = phase
    for fn in FRAMES:
        fn(bit)
check("a burst bit waiting for its answer hides WA's sprite", bit.sprite == 0, repr(bit.sprite))
check("and is not decided yet", sb.role(81) is None, repr(sb.role(81)))
WORLD["frame"] += 1
call(81, 0, "test.flash", 1000, 1000)
check("the next frame it is a bit", sb.role(81) == "bit", repr(sb.role(81)))

# ---- A state switch keeps its actor -----------------------------------------
# Homing art from `arm` on: the follower used to be despawned and a new one
# spawned with no motion history, so the switch frame drew untweened. The same
# actor now takes the new sheet with `a:look`, and keeps its history.
homing = lua.table_from({"sheet": "sprites/test/homing.png", "arm": 100, "time": 0, "anim": "track"})
flight("test.look", track=False, homing=homing)
spawned, looked, despawned = len(SPAWNS), len(LOOKS), len(DESPAWNS)
for _ in range(10):  # 200 ms: past `arm`
    step(90, 0, "test.look")
check("a state switch spawns no second actor", len(SPAWNS) - spawned == 1, str(len(SPAWNS) - spawned))
check("and despawns none", len(DESPAWNS) == despawned, str(len(DESPAWNS) - despawned))
new_looks = LOOKS[looked:]
check(
    "the follower takes the homing sheet in place",
    len(new_looks) == 1 and new_looks[0][1] == "sprites/test/homing.png",
    repr([sheet for _, sheet in new_looks]),
)

if fails > 0:
    print(f"\n{fails} check(s) failed")
    sys.exit(1)
print("\nall checks passed")
