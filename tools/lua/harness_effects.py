"""Run the effects SDK (`px_effects` + `trail`) against a fake `wa`.

Everything in these two modules runs inside Worms Armageddon: an emitter is a
hidden actor with a brain, a ring is a ribbon rebuilt every frame, and the
ribbon trail is sampled from missile frames. A mistake there (a nil upvalue, a
ring that never follows, an emitter that never dies, a rainbow that reads a
clock the simulation does not have) costs a round trip into the game, so this
drives the real library frame by frame and reports what it drew.

    python -m pip install lupa
    python tools/lua/harness_effects.py          # exits 1 on a failure

It is a development aid, not part of `bun run lint` / `build`: `lupa` is not a
project dependency.
"""
import math
import os
import sys

from lupa import LuaRuntime

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'spec', 'lua_sdk', 'effects_sdk')
lua = LuaRuntime(unpack_returned_tuples=True)

FAILED = []


def check(name, ok, detail=''):
    print(f"{'ok  ' if ok else 'FAIL'}  {name}" + ('' if ok or not detail else f'  ({detail})'))
    if not ok:
        FAILED.append(name)


# --------------------------------------------------------------- the fake wa ---
STATE = {'frame': 0, 'spawned': 0, 'despawned': 0, 'drawn': [], 'quads': [], 'draws': []}
LOGS = []
WORM = {'id': 1, 'hp': 100, 'turn': True, 'x': 1000.0, 'y': 1000.0}
MISSILES = []

wa = lua.table()
lua.globals()['wa'] = wa
wa.log = lambda msg: LOGS.append(str(msg))

wa.depth = lua.table()
wa.depth.FRONT = 1
wa.depth.EFFECTS = 2
wa.depth.OBJECTS = 3

wa.random = lambda a=0, b=1: a

wa.math = lua.table()
wa.math.sin = math.sin
wa.math.cos = math.cos
wa.math.atan = math.atan2


def worm_handle(_id=None):
    t = lua.table()
    for key, value in WORM.items():
        t[key] = value
    return t


wa.worms = lua.table()
wa.worms.all = lambda: lua.table_from([worm_handle()])

wa.missiles = lua.table()
wa.missiles.all = lambda: lua.table_from(MISSILES)

wa.land = lua.table()
wa.land.trace = lambda x0, y0, x1, y1: lua.table_from({'hit': False})
wa.land.solid = lambda x, y: False
wa.land.cut = lambda opts: None


def spawn(spec):
    STATE['spawned'] += 1
    handle = lua.table()
    handle['_spec'] = spec
    # `a:despawn()` passes the handle, so the stub takes it and ignores it.
    handle['despawn'] = lambda *_: STATE.__setitem__('despawned', STATE['despawned'] + 1)
    ACTORS.append(handle)
    return handle


ACTORS = []
wa.actors = lua.table()
wa.actors.spawn = spawn


def draw_ribbon(table):
    # `RIBBON` is one reused table, so the points have to be copied now.
    points = table['points']
    copied = []
    for i, p in points.items():
        copied.append(
            {
                'x': p['x'],
                'y': p['y'],
                'width': p['width'],
                'u': p['u'],
                'color': p['color'],
            }
        )
    STATE['drawn'].append({'sprite': table['sprite'], 'blend': table['blend'], 'points': copied})


def draw_quad(table):
    pts = table['points']
    p1 = pts[1]
    STATE['quads'].append(
        {
            'sprite': table['sprite'],
            'x': p1['x'],
            'y': p1['y'],
            'color': table['color'],
            'blend': table['blend'],
        }
    )


wa.draw = lua.table()
wa.draw.ribbon = draw_ribbon
wa.draw.quad = draw_quad

DRAW = []
MISSILE_FRAME = []
wa.on = lua.table()
wa.on.draw = lambda fn: DRAW.append(fn)
wa.on.missile_frame = lambda fn: MISSILE_FRAME.append(fn)

# ------------------------------------------------------------------- load it ---
# The library requires its sibling by pack path (`wf-lib/effects/trail`), so the
# two files are preloaded under the names the engine would give them.
def preload(name, path):
    with open(path, encoding='utf-8') as handle:
        source = handle.read()
    lua.execute('package.preload[%r] = function()\n%s\nend' % (name, source))

preload('wf-lib/effects/trail', f'{ROOT}/libs/trail.lua')
preload('wf-lib/effects/px_effects', f'{ROOT}/libs/px_effects.lua')
preload('wf-lib/effects/custom_explosion', f'{ROOT}/libs/custom_explosion.lua')
fx = lua.eval('require("wf-lib/effects/px_effects")')
trail = lua.eval('require("wf-lib/effects/trail")')
blast = lua.eval('require("wf-lib/effects/custom_explosion")')
if isinstance(fx, tuple):
    fx = fx[0]
if isinstance(trail, tuple):
    trail = trail[0]
if isinstance(blast, tuple):
    blast = blast[0]


def lua_table(chunk):
    """A real Lua table from a Lua literal, as the engine would build it."""
    return lua.eval('(function() return ' + chunk + ' end)()')


def tick_actors():
    STATE['frame'] += 1
    for actor in list(ACTORS):
        spec = actor['_spec']
        if spec is not None and spec['on'] is not None:
            spec['on'](actor)


def draw():
    STATE['drawn'].clear()
    STATE['quads'].clear()
    for fn in DRAW:
        fn()


def install():
    fx.install(lua.eval('{ trail = true }'))


install()
check('install registers one draw callback', len(DRAW) >= 1, str(len(DRAW)))
check('install registers the missile frame sampler', len(MISSILE_FRAME) == 1)

# ------------------------------------------------------------------ emitter ---
POS = {'x': 500.0, 'y': 400.0, 'alive': True}


def follow():
    if not POS['alive']:
        return None
    return POS['x'], POS['y'], 1.0, 0.0


opts = lua_table(
    """{
  x = 500, y = 400,
  preset = "electric",
  ring = { radius = 26, segments = 22, noise = 0.9, speed = 0,
    ellipse = { 1.2, 0.45 }, r = 160, g = 200, b = 255 },
  trail = { max = 12, every = 1, core_w = 5, glow_w = 11, noise = 2,
    r = 160, g = 200, b = 255 },
}"""
)
opts['follow'] = follow
# `spark = true` is how a generated bundle says "on with the preset's numbers".
# It used to be indexed as a table and threw, which took the whole `on_fire`
# down and drew nothing at all.
opts['spark'] = True
opts['glow'] = True

emitter = fx.emitter(opts)
check('fx.emitter returns a handle', emitter is not None)
check('it spawned a driver', STATE['spawned'] >= 1, str(STATE['spawned']))
check('it built a ring', emitter['ring'] is not None)

for _ in range(6):
    tick_actors()
draw()

ring_calls = [d for d in STATE['drawn'] if d['sprite'] is not None]
check('it draws something', len(ring_calls) >= 1, str(len(ring_calls)))

# The ring rides the emitter. A ribbon pass has at most `max` points (12 here)
# and the ring has segments + 1 (23), so the ring's own loop is the long one.
def ring_pass(near=None):
    """The ring the SDK drew this frame, optionally the one centred at a point.

    Several emitters can be alive at once (the static one, the tracking one), and
    every `draw` paints all of them: picking the first loop measured whichever
    emitter was drawn first, which is how a quarter-turn assertion can pass or
    fail for a reason that has nothing to do with rotation.
    """
    loops = [d for d in STATE['drawn'] if len(d['points']) == 23]
    if near is not None:
        loops = [
            loop
            for loop in loops
            if abs(ring_centre(loop)[0] - near[0]) < 12
            and abs(ring_centre(loop)[1] - near[1]) < 12
        ]
    return loops[0] if loops else None


def ring_centre(loop):
    xs = [p['x'] for p in loop['points']]
    ys = [p['y'] for p in loop['points']]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


before = ring_pass()
check('the ring is drawn as a closed loop', before is not None, f'{len(STATE["drawn"])} draws')
POS['x'] = 700.0
POS['y'] = 300.0
for _ in range(3):
    tick_actors()
draw()
after = ring_pass()
check(
    'the ring follows the emitter',
    before is not None
    and after is not None
    and abs(ring_centre(after)[0] - 700) < 12
    and abs(ring_centre(after)[1] - 300) < 12,
    f'{ring_centre(before) if before else None} -> {ring_centre(after) if after else None}',
)
check(
    'the ring state is where the emitter is',
    abs(emitter['ring']['x'] - 700) < 0.001 and abs(emitter['ring']['y'] - 300) < 0.001,
    f"({emitter['ring']['x']}, {emitter['ring']['y']})",
)

# The bend: an ellipse with x/y 1.2 and 0.45 is wider than it is tall.
widest = after if after is not None else ring_pass()
xs = [p['x'] for p in widest['points']]
ys = [p['y'] for p in widest['points']]
span_x = max(xs) - min(xs)
span_y = max(ys) - min(ys)
check('the ring is bent into the ellipse', span_x > span_y * 1.8, f'{span_x:.1f} x {span_y:.1f}')

# The emitter's own ribbon got samples.
check('the emitter feeds its ribbon', trail.has(-1), 'no trail for the emitter key')

# ------------------------------------------------- the ring tracks a heading ---
# `track = true` aligns the bend with the owner's velocity, which is how the
# panel's "Track Heading" switch reaches the SDK.
MOVING = {'x': 300.0, 'y': 300.0, 'vx': 4.0, 'vy': 0.0}


def moving():
    return MOVING['x'], MOVING['y'], MOVING['vx'], MOVING['vy']


opts2 = lua_table(
    '{ x = 300, y = 300, ring = { radius = 26, segments = 22, speed = 0.5,'
    ' angle = 0, ellipse = { 1.2, 0.45 }, track = true } }'
)
opts2['follow'] = moving
tracking = fx.emitter(opts2)
check('a tracking emitter exists', tracking is not None)
for _ in range(3):
    tick_actors()
# The test fake's atan2 is Python's, so a level heading is 0 and straight down
# is +pi/2 (world y is down).
check(
    'a level heading leaves the bend level',
    abs(tracking['ring']['angle']) < 0.05,
    str(tracking['ring']['angle']),
)
MOVING['vx'], MOVING['vy'] = 0.0, 4.0
for _ in range(2):
    tick_actors()
check(
    'a downward heading turns the bend a quarter turn',
    abs(tracking['ring']['angle'] - math.pi / 2) < 0.05,
    str(tracking['ring']['angle']),
)
draw()
turned = ring_pass((MOVING['x'], MOVING['y']))
turned_xs = [p['x'] for p in turned['points']]
turned_ys = [p['y'] for p in turned['points']]
check(
    'turning a quarter turn rotates the drawn ellipse vertically',
    (max(turned_ys) - min(turned_ys)) > (max(turned_xs) - min(turned_xs)) * 1.8,
    f'{max(turned_xs) - min(turned_xs):.1f} x {max(turned_ys) - min(turned_ys):.1f}',
)
angle_after = tracking['ring']['angle']
for _ in range(3):
    tick_actors()
check(
    'tracking ignores the spin',
    abs(tracking['ring']['angle'] - angle_after) < 0.001,
    f'{angle_after} -> {tracking["ring"]["angle"]}',
)
check(
    'and keeps the author angle as an offset',
    abs(tracking['ring']['angle_offset']) < 0.001,
    str(tracking['ring']['angle_offset']),
)
# Leave nothing behind for the death-cascade checks below.
tracking['remove'](tracking)
for _ in range(2):
    tick_actors()


# ---------------------------------------------------------------- the ring ---
ring = fx.ring(
    lua_table(
        """{ x = 100, y = 100, radius = 40, segments = 16, speed = 0.1,
  ellipse = { 1.0, 0.5 }, rainbow = true }"""
    )
)
check('fx.ring returns a handle', ring is not None)
for _ in range(4):
    tick_actors()
draw()
check('a ring draws without an emitter', len(STATE['drawn']) >= 1)

# Rainbow: the same ring, two frames apart, colours differently.
first = [p['color'] for d in STATE['drawn'] for p in d['points']]
for _ in range(4):
    tick_actors()
draw()
second = [p['color'] for d in STATE['drawn'] for p in d['points']]
check('a rainbow ring changes colour with the clock', first and second and first != second)

# One switch on the emitter colours every part that does not set one, as PX's
# single SetRainbowMode does.
rb = fx.emitter(
    lua_table(
        '{ x = 0, y = 0, owner = WORM, rainbow = true,'
        ' ring = { radius = 20, segments = 12 } }'
    )
)
check(
    'the emitter rainbow reaches its ring',
    rb is not None and rb['ring'] is not None and rb['ring']['rainbow'] is not None,
    str(rb['ring']['rainbow'] if rb is not None and rb['ring'] else None),
)
check(
    'and its ribbon',
    rb is not None and rb['trail'] and rb['trail']['rainbow'] is not None,
    str(rb['trail']['rainbow'] if rb is not None and rb['trail'] else None),
)
if rb is not None:
    rb['dead'] = True
    rb['trail'] = False

# ------------------------------------------------------------- the rainbow ---
plain = fx.burst(
    lua_table('{ x = 10, y = 10, radius = 40, duration = 10, smoke = false }')
)
rainbow = fx.burst(
    lua_table(
        '{ x = 10, y = 10, radius = 40, duration = 10, smoke = false, rainbow = true }'
    )
)
check('both bursts exist', plain is not None and rainbow is not None)
for _ in range(3):
    tick_actors()
draw()
colours = set()
for d in STATE['drawn']:
    for p in d['points']:
        colours.add(p['color'])
check('a rainbow burst draws more than one hue', len(colours) > 1, f'{len(colours)} colours')

# ------------------------------------------------------------------- reach ---
STATE['drawn'].clear()
reach_emitter = fx.emitter(
    lua_table(
        """{ x = 200, y = 200, preset = "thunder", trail = false,
  reach = { count = 1, first = { 1, 1 } } }"""
    )
)
check('a thunder emitter exists', reach_emitter is not None)
bolts = 0
for _ in range(8):
    tick_actors()
    bolts = max(bolts, len(reach_emitter['arcs']))
check('it starts its bolt', bolts >= 1, f'{bolts} bolts')

# ---------------------------------------------------------- death and cleanup --
# ------------------------------------------------------- emitter colour + aim ---
# Generated tables use one top-level RGB color and explicit reach direction and
# spread. These are applied by the SDK, not just the preview.
colored = fx.emitter(
    lua_table(
        """{ x = 80, y = 90, owner = WORM, preset = "electric",
  color = { r = 192, g = 96, b = 64 }, spark = true, glow = true,
  reach = { count = 1, first = { 1, 1 }, direction = 0, spread = 0,
    distance = 20 } }"""
    )
)
check(
    'emitter RGB reaches spark, glow, reach and ribbon',
    colored is not None
    and colored['spark']['r'] == 192
    and colored['glow']['g'] == 96
    and colored['reach']['b'] == 64
    and colored['trail']['r'] == 192,
    'top-level color did not reach every part',
)
for _ in range(3):
    tick_actors()
arc = colored['arcs'][1]
check(
    'fixed reach direction points right in screen coordinates',
    arc is not None
    and abs(arc['to_x'] - (colored['x'] + 20)) < 0.001
    and abs(arc['to_y'] - colored['y']) < 0.001,
    f"({arc['to_x'] if arc else None}, {arc['to_y'] if arc else None})",
)
no_bolts = fx.emitter(
    lua_table('{ x = 20, y = 30, owner = WORM, preset = "electric", reach = false }')
)
for _ in range(4):
    tick_actors()
check(
    'explicit reach false overrides preset bolt count',
    no_bolts is not None and no_bolts['reach']['count'] == 0 and len(no_bolts['arcs']) == 0,
    f"count={no_bolts['reach']['count'] if no_bolts else None}",
)
colored['dead'] = True
no_bolts['dead'] = True

POS['alive'] = False
tick_actors()
check('the emitter dies with its anchor', emitter['dead'] is True)
check('and its ring dies with it', emitter['ring']['done'] is True)
for _ in range(40):
    tick_actors()
check('the driver despawns once nothing is left', STATE['despawned'] >= 1, str(STATE['despawned']))

# ----------------------------------------------------------- trail sampling ---
STATE['drawn'].clear()
trail.add(7, worm_handle(), lua_table('{ max = 8, every = 1, noise = 3 }'))
for i in range(6):
    for fn in MISSILE_FRAME:
        m = lua_table(
            '{ id = 7, x = %d, y = %d, vx = 1, vy = 2, phase = "post" }'
            % (100 + i, 100 + i * 2)
        )
        fn(m)
draw()
check('the ribbon trail draws from samples', len(STATE['drawn']) >= 2, str(len(STATE['drawn'])))
# A noisy ribbon is not a straight line: the middle point leaves the chord.
noisy = STATE['drawn'][0]['points']
if len(noisy) >= 3:
    a, b, mid = noisy[0], noisy[-1], noisy[len(noisy) // 2]
    dx, dy = b['x'] - a['x'], b['y'] - a['y']
    length = math.hypot(dx, dy) or 1.0
    off = abs((mid['x'] - a['x']) * dy - (mid['y'] - a['y']) * dx) / length
    check('the trail noise bends the ribbon', off > 0.2, f'{off:.2f} px off the chord')
else:
    check('the trail noise bends the ribbon', False, 'too few points')

# ------------------------------------------------- siblings of one bundle ---
# `wa._mod` is the component, not the bundle: the engine resolves a sheet
# through the other components of the same bundle, but `fx.install` registers one
# callback per component that calls it and paints only that component's effects.
# A bundle that installs from its first weapon therefore used to lose every
# effect its second weapon made, with no error at all: the saw's aura on a placed
# saw (px.saw_place), the death mark's thunder (px.marked_for_death). An effect
# whose component never installed is adopted by the installer sharing the longest
# id prefix with it, once, and the log names it.
wa._mod = 'px.saw_grenade'
install()


COUNT = [0]


def sibling(mod):
    """A ring made by `mod`, the callbacks that painted it, and its passes."""
    COUNT[0] += 1
    x, y = 1200.0 + 40 * COUNT[0], 5600.0
    wa._mod = mod
    item = fx.ring(
        lua_table('{ x = %d, y = %d, radius = 30, segments = 16 }' % (x, y))
    )
    painters, passes = set(), 0
    for index, fn in enumerate(DRAW):
        STATE['drawn'].clear()
        fn()
        for d in STATE['drawn']:
            n = len(d['points'])
            cx = sum(p['x'] for p in d['points']) / n
            cy = sum(p['y'] for p in d['points']) / n
            if abs(cx - x) < 12 and abs(cy - y) < 12:
                painters.add(index)
                passes += 1
    return item, painters, passes


own, own_painters, own_passes = sibling('px.saw_grenade')
placed, placed_painters, placed_passes = sibling('px.saw_place')
random_saw, random_painters, random_passes = sibling('px.saw_random')
foreign, foreign_painters, foreign_passes = sibling('otherpack.thing')
check(
    'a component that installed paints its own effect once',
    len(own_painters) == 1 and own_passes >= 1,
    f'{len(own_painters)} callbacks, {own_passes} passes',
)
check(
    'a sibling component effect is adopted by the installer',
    placed is not None and placed['mod'] == 'px.saw_grenade',
    str(placed['mod'] if placed is not None else None),
)
check(
    'and painted by exactly that one callback',
    placed_painters == own_painters and placed_passes == own_passes,
    f'{len(placed_painters)} callbacks, {placed_passes} passes',
)
check(
    'the same for a feature component',
    random_saw is not None and random_painters == own_painters and random_passes == own_passes,
    f"{random_saw['mod'] if random_saw is not None else None} {len(random_painters)} callbacks",
)
check(
    'an unrelated id is left alone and nothing paints it',
    foreign is not None and foreign['mod'] == 'otherpack.thing' and foreign_passes == 0,
    f"{foreign['mod'] if foreign is not None else None} {foreign_passes} passes",
)
check(
    'the log names an adopted component',
    any('px.saw_place' in line and 'drawn as px.saw_grenade' in line for line in LOGS),
    str(LOGS[-2:]),
)

# ------------------------------------------------ custom_explosion + emitter fixes ---
wa._mod = 'px.saw_grenade'
wa.world = wa.world or lua.table()
wa.world.blast = lambda o: 0
captured_burst = []
orig_burst = fx['burst']
def capture_burst(spec):
    captured_burst.append(dict(spec))
    return orig_burst(spec)
fx['burst'] = capture_burst
blast.explode(lua_table(
    '{ x = 400, y = 400, damage = 20, push = 50, hole = 20, destroy = true, '
    'effect = { radius = 60, core = 30, rainbow = true } }'
))
check(
    'blast.explode forwards core and rainbow to fx.burst',
    len(captured_burst) == 1 and captured_burst[0].get('core') == 30 and captured_burst[0].get('rainbow') is True,
    str(captured_burst[0] if captured_burst else 'none'),
)
fx['burst'] = orig_burst

th = fx.emitter(lua_table(
    '{ x = 300, y = 300, preset = "thunder", spark = true, glow = true, '
    'color = { r = 0, g = 0, b = 255 }, trail = { r = 255, g = 10, b = 20 } }'
))
check(
    'thunder emitter with explicit spark = true and glow = true enables both',
    th is not None and th['spark'] is not None and th['glow'] is not None,
    f"spark={th['spark'] if th else None}, glow={th['glow'] if th else None}",
)
check(
    'explicit emitter trail RGB is preserved over top-level color',
    th is not None and th['trail'] is not False and th['trail']['r'] == 255 and th['trail']['g'] == 10 and th['trail']['b'] == 20,
    f"trail={dict(th['trail']) if th and th['trail'] else None}",
)

print()
if FAILED:
    print(f'{len(FAILED)} check(s) failed')
    sys.exit(1)
print('all checks passed')
