"""Builds apps/web/public/team-floor/characters.glb (SPEC 12.1 item 3). Original, project-owned work.

  blender --background --factory-startup --python scripts/team-floor/blender/build_characters.py -- \
      [--export] [--preview] [--save-blend]

One shared armature (metric, ~1.76 m), body meshes in two builds (broad, slim) x two sleeve lengths,
hair variants matching AvatarConfig.hairStyle (short, long, bun, curly; bald = none), a phone and a
document prop parented to the hands, and looping clips:
  idle, sit, typing, phone_sit, phone_stand, walk, walk_carry, wave, wave_sit, sleep_sit, receive_sit.
Material slots (names are the runtime contract): skin, hair, top, bottom, shoes, eyes, accent.
The runtime merges one body + one hair mesh per person and tints slots from AvatarConfig.
Front = Blender -Y (glTF +Z). Seated clips put the pelvis on a 0.47 m seat centred on the origin.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(__file__))

from common import OUT_TMP, PUBLIC, cli_args, material, reset_scene  # noqa: E402

FPS = 30
SLOTS = {
    'skin': '#c68642',
    'hair': '#1f1a17',
    'top': '#4f46e5',
    'bottom': '#2f3a4a',
    'shoes': '#2a2a2a',
    'eyes': '#1b1716',
    'accent': '#e9e4dc',
}

# ---------------------------------------------------------------- skeleton (rest pose, metres)

BONES = [
    # name, head, tail, parent
    ('root', (0, 0, 0), (0, 0, 0.12), None),
    ('hips', (0, 0, 0.95), (0, 0, 1.06), 'root'),
    ('spine', (0, 0, 1.06), (0, 0, 1.22), 'hips'),
    ('chest', (0, 0, 1.22), (0, 0, 1.43), 'spine'),
    ('neck', (0, 0, 1.45), (0, 0, 1.53), 'chest'),
    ('head', (0, 0, 1.53), (0, 0, 1.78), 'neck'),
    ('shoulder.L', (0.04, 0, 1.41), (0.18, 0, 1.42), 'chest'),
    ('upper_arm.L', (0.2, 0, 1.4), (0.232, 0, 1.12), 'shoulder.L'),
    ('forearm.L', (0.232, 0, 1.12), (0.25, -0.01, 0.87), 'upper_arm.L'),
    ('hand.L', (0.25, -0.01, 0.87), (0.254, -0.01, 0.77), 'forearm.L'),
    ('thigh.L', (0.092, 0, 0.92), (0.094, 0, 0.5), 'hips'),
    ('shin.L', (0.094, 0, 0.5), (0.096, 0.01, 0.09), 'thigh.L'),
    ('foot.L', (0.096, 0.01, 0.09), (0.098, -0.13, 0.03), 'shin.L'),
]
for name, h, t, parent in list(BONES):
    if name.endswith('.L'):
        BONES.append((name[:-2] + '.R', (-h[0], h[1], h[2]), (-t[0], t[1], t[2]), (parent[:-2] + '.R') if parent and parent.endswith('.L') else parent))


def build_armature():
    arm_data = bpy.data.armatures.new('Rig')
    arm = bpy.data.objects.new('Rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    ebs = {}
    for name, h, t, parent in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = h
        eb.tail = t
        if name.startswith('foot'):
            eb.align_roll(Vector((0, 0, 1)))
        else:
            eb.align_roll(Vector((0, -1, 0)))
        if parent:
            eb.parent = ebs[parent]
            eb.use_connect = False
        ebs[name] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'XYZ'
    return arm


# ---------------------------------------------------------------- body geometry

def superellipse(rx, ry, n=14, p=2.6):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c, s = math.cos(a), math.sin(a)
        x = rx * math.copysign(abs(c) ** (2 / p), c)
        y = ry * math.copysign(abs(s) ** (2 / p), s)
        pts.append((x, y))
    return pts


class Part:
    def __init__(self, bm, layer, mats):
        self.bm = bm
        self.layer = layer
        self.mats = mats

    def mi(self, slot):
        if slot not in self.mats:
            self.mats.append(slot)
        return self.mats.index(slot)

    def loft(self, rings, slot_of_ring, tag, cap_bottom=True, cap_top=True, n=14, p=2.6, offset=(0, 0)):
        """rings: list of (z, rx, ry, dy). Faces between ring i and i+1 use slot_of_ring(i)."""
        bm = self.bm
        loops = []
        for z, rx, ry, dy in rings:
            loops.append([bm.verts.new((offset[0] + x, offset[1] + y + dy, z)) for x, y in superellipse(rx, ry, n, p)])
        for v in (v for loop in loops for v in loop):
            v[self.layer] = tag
        faces = []
        for i in range(len(loops) - 1):
            a, b = loops[i], loops[i + 1]
            for k in range(n):
                f = bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
                f.material_index = self.mi(slot_of_ring(i))
                f.smooth = True
                faces.append(f)
        if cap_bottom:
            f = bm.faces.new(list(reversed(loops[0])))
            f.material_index = self.mi(slot_of_ring(0))
            f.smooth = True
        if cap_top:
            f = bm.faces.new(loops[-1])
            f.material_index = self.mi(slot_of_ring(len(loops) - 2))
            f.smooth = True
        return faces

    def tube(self, a, b, radii, slots, tag, n=10):
        """Tube from point a to b with len(radii) rings (evenly spaced). slots[i] for segment i."""
        a, b = Vector(a), Vector(b)
        axis = (b - a)
        length = axis.length
        q = axis.normalized().to_track_quat('Z', 'Y')
        rot = q.to_matrix().to_4x4()
        bm = self.bm
        loops = []
        for i, r in enumerate(radii):
            t = i / (len(radii) - 1)
            c = a + axis * t
            loop = []
            for k in range(n):
                ang = 2 * math.pi * k / n
                p = rot @ Vector((math.cos(ang) * r, math.sin(ang) * r, 0))
                v = bm.verts.new(c + p)
                v[self.layer] = tag
                loop.append(v)
            loops.append(loop)
        for i in range(len(loops) - 1):
            for k in range(n):
                f = bm.faces.new((loops[i][k], loops[i][(k + 1) % n], loops[i + 1][(k + 1) % n], loops[i + 1][k]))
                f.material_index = self.mi(slots[i])
                f.smooth = True
        for loop, s in ((loops[0], slots[0]), (loops[-1], slots[-1])):
            f = bm.faces.new(loop if loop is loops[-1] else list(reversed(loop)))
            f.material_index = self.mi(s)
            f.smooth = True
            bmesh.ops.poke(bm, faces=[f])

    def blob(self, center, scale, slot, tag, subdiv=2, rot=(0, 0, 0), smooth=True):
        m = Matrix.Translation(Vector(center)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=1.0, matrix=m)
        idx = self.mi(slot)
        for v in res['verts']:
            v[self.layer] = tag
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = idx
            f.smooth = smooth

    def box(self, center, size, slot, tag, bevel=0.01, rot=(0, 0, 0)):
        before = set(self.bm.verts)
        m = Matrix.Translation(Vector(center)) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        new = [v for v in self.bm.verts if v not in before]
        if bevel:
            edges = list({e for v in new for e in v.link_edges})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
            new = [v for v in self.bm.verts if v not in before]
        idx = self.mi(slot)
        for v in new:
            v[self.layer] = tag
        for f in {f for v in new for f in v.link_faces}:
            f.material_index = idx
            f.smooth = True


# Part tags drive the skin weights.
TAG = {'torso': 1, 'pelvis': 2, 'leg.L': 3, 'leg.R': 4, 'arm.L': 5, 'arm.R': 6, 'hand.L': 7, 'hand.R': 8, 'foot.L': 9, 'foot.R': 10, 'neck': 11, 'head': 12}


def build_body(build, sleeves):
    """build: 'broad' | 'slim'; sleeves: 'long' | 'short'."""
    bm = bmesh.new()
    layer = bm.verts.layers.int.new('part')
    mats = []
    P = Part(bm, layer, mats)
    broad = build == 'broad'
    sw = 1.0 if broad else 0.9  # shoulder/chest width factor
    hw = 0.98 if broad else 1.0  # hip width factor

    # Torso: shirt from the hip line to the shoulders, slightly forward chest.
    rings = [
        (0.97, 0.158 * hw, 0.102, 0.0),
        (1.05, 0.152 * (0.98 if broad else 0.92), 0.1, 0.0),
        (1.16, 0.158 * sw, 0.108, -0.006),
        (1.28, 0.176 * sw, 0.118, -0.01),
        (1.37, 0.186 * sw, 0.115, -0.006),
        (1.43, 0.172 * sw, 0.1, 0.0),
        (1.47, 0.1 * sw, 0.075, 0.0),
    ]
    P.loft(rings, lambda i: 'top', TAG['torso'], cap_bottom=False)
    # Collar accent and a lanyard-free placket line for readability.
    P.loft([(1.445, 0.078, 0.06, 0.0), (1.475, 0.07, 0.056, 0.0)], lambda i: 'accent', TAG['torso'], cap_bottom=False, cap_top=False, n=12)

    # Pelvis (trousers).
    P.loft([(0.86, 0.16 * hw, 0.1, 0.0), (0.92, 0.165 * hw, 0.104, 0.0), (0.99, 0.16 * hw, 0.102, 0.0)], lambda i: 'bottom', TAG['pelvis'])

    # Legs: one tube hip -> ankle per side, trousers to the ankle.
    for side, tag in ((1, 'leg.L'), (-1, 'leg.R')):
        x = 0.092 * side
        P.tube((x, 0, 0.93), (x * 1.02, 0.01, 0.1), [0.078, 0.074, 0.066, 0.06, 0.057, 0.055, 0.052, 0.048, 0.047], ['bottom'] * 8, TAG[tag], n=12)
        # Shoe: rounded wedge from the ankle forward.
        P.box((x * 1.04, -0.045, 0.045), (0.105, 0.25, 0.085), 'shoes', TAG['foot.L' if side > 0 else 'foot.R'], bevel=0.03)
        P.box((x * 1.04, -0.05, 0.008), (0.11, 0.26, 0.016), 'accent', TAG['foot.L' if side > 0 else 'foot.R'], bevel=0.006)

    # Arms: shoulder -> wrist tube; sleeve material depends on the variant.
    for side, tag, htag in ((1, 'arm.L', 'hand.L'), (-1, 'arm.R', 'hand.R')):
        sx = side * (1.0 if broad else 0.93)
        a = (0.198 * sx, 0, 1.41)
        b = (0.25 * sx, -0.01, 0.875)
        radii = [0.056, 0.054, 0.05, 0.047, 0.045, 0.042, 0.04, 0.037, 0.034]
        if not broad:
            radii = [r * 0.9 for r in radii]
        if sleeves == 'long':
            slots = ['top'] * 7 + ['accent']
        else:
            slots = ['top', 'top', 'top', 'skin', 'skin', 'skin', 'skin', 'skin']
        P.tube(a, b, radii, slots, TAG[tag], n=10)
        # Shoulder cap so the arm joins the torso smoothly.
        P.blob((0.182 * sx, 0, 1.4), (0.07, 0.066, 0.062), 'top', TAG['torso'], subdiv=2)
        # Mitten hand with a thumb (palm faces the body at rest).
        P.box((0.254 * sx, -0.012, 0.815), (0.042, 0.08, 0.1), 'skin', TAG[htag], bevel=0.016)
        P.box((0.246 * sx, -0.05, 0.835), (0.026, 0.03, 0.05), 'skin', TAG[htag], bevel=0.01, rot=(0.3, 0, 0))

    # Neck and head (slightly stylised: head ~1.12x real).
    P.tube((0, 0.004, 1.44), (0, 0.0, 1.56), [0.048, 0.047, 0.046], ['skin', 'skin'], TAG['neck'], n=10)
    head_c = (0, -0.008, 1.645)
    P.blob(head_c, (0.112, 0.122, 0.135), 'skin', TAG['head'], subdiv=3)
    P.blob((0, -0.008, 1.585), (0.09, 0.1, 0.07), 'skin', TAG['head'], subdiv=2)  # jaw
    for side in (1, -1):
        P.blob((0.04 * side, -0.115, 1.655), (0.014, 0.008, 0.018), 'eyes', TAG['head'], subdiv=1)
        P.blob((0.111 * side, -0.002, 1.635), (0.018, 0.028, 0.034), 'skin', TAG['head'], subdiv=1)  # ears
        P.box((0.04 * side, -0.112, 1.69), (0.034, 0.012, 0.01), 'hair', TAG['head'], bevel=0.003, rot=(0, 0.08 * side, 0))  # brows
    P.blob((0, -0.128, 1.625), (0.016, 0.022, 0.026), 'skin', TAG['head'], subdiv=1)  # nose
    P.box((0, -0.112, 1.582), (0.03, 0.01, 0.007), 'eyes', TAG['head'], bevel=0.002)  # mouth
    return bm, layer, mats


def build_hair(style):
    bm = bmesh.new()
    layer = bm.verts.layers.int.new('part')
    mats = []
    P = Part(bm, layer, mats)
    t = TAG['head']
    hc = Vector((0, -0.006, 1.66))
    if style in ('short', 'long', 'bun'):
        # Cap: an ellipsoid shifted up and back so the face stays clear below the hairline (~1.72 m).
        P.blob(Vector((0, 0.022, 1.703)), (0.119, 0.129, 0.104), 'hair', t, subdiv=3)
        P.blob(Vector((0, -0.088, 1.748)), (0.088, 0.042, 0.03), 'hair', t, subdiv=2, rot=(0.25, 0, 0))
    if style == 'short':
        P.blob(Vector((0, 0.05, 1.63)), (0.108, 0.088, 0.08), 'hair', t, subdiv=2)
        for side in (1, -1):
            P.box(Vector((0.106 * side, -0.02, 1.665)), (0.016, 0.034, 0.05), 'hair', t, bevel=0.006)
    elif style == 'long':
        P.box(Vector((0, 0.075, 1.52)), (0.23, 0.075, 0.32), 'hair', t, bevel=0.035)
        for side in (1, -1):
            P.box(Vector((0.108 * side, 0.0, 1.57)), (0.036, 0.1, 0.24), 'hair', t, bevel=0.016)
    elif style == 'bun':
        P.blob(Vector((0, 0.06, 1.64)), (0.11, 0.085, 0.09), 'hair', t, subdiv=2)
        P.blob(Vector((0, 0.118, 1.74)), (0.062, 0.058, 0.058), 'hair', t, subdiv=2)
    elif style == 'curly':
        import random
        rng = random.Random(4)
        for k in range(52):
            th = rng.uniform(0, 2 * math.pi)
            ph = rng.uniform(0.0, 1.5)
            fy = math.sin(th) * math.sin(ph)
            if fy < -0.45 and ph > 0.75:
                continue  # keep the face clear
            r = 0.122
            p = Vector((math.cos(th) * math.sin(ph) * r, 0.012 + fy * r * 1.05, 1.665 + math.cos(ph) * r * 0.95))
            if p.z < 1.6 and p.y < 0:
                continue
            P.blob(p, (0.04, 0.04, 0.036), 'hair', t, subdiv=1, smooth=False)
        P.blob(Vector((0, 0.035, 1.665)), (0.112, 0.1, 0.1), 'hair', t, subdiv=2)
    return bm, layer, mats


def to_mesh_object(name, bm, layer, mats, arm, skin_for_tag):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    tags = {v.index: v[layer] for v in bm.verts}
    coords = {v.index: v.co.copy() for v in bm.verts}
    bm.to_mesh(me)
    bm.free()
    for slot in mats:
        me.materials.append(material(slot, color=SLOTS[slot], roughness=0.75 if slot != 'eyes' else 0.3))
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = arm
    groups = {}
    for b in arm.data.bones:
        groups[b.name] = obj.vertex_groups.new(name=b.name)
    for vi, tag in tags.items():
        for bone, w in skin_for_tag(tag, coords[vi]).items():
            if w > 0:
                groups[bone].add([vi], w, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return obj


def smooth(t, a, b):
    if t <= a:
        return 0.0
    if t >= b:
        return 1.0
    x = (t - a) / (b - a)
    return x * x * (3 - 2 * x)


def skin_weights(tag, co):
    z = co.z
    if tag == TAG['head']:
        return {'head': 1.0}
    if tag == TAG['neck']:
        k = smooth(z, 1.5, 1.56)
        return {'neck': 1 - k * 0.5, 'head': k * 0.5}
    if tag == TAG['torso']:
        if abs(co.x) > 0.15 and z > 1.33:
            # Shoulder cap region follows the clavicle.
            side = 'L' if co.x > 0 else 'R'
            k = smooth(abs(co.x), 0.15, 0.2)
            return {'chest': 1 - k * 0.6, f'shoulder.{side}': k * 0.6}
        a = smooth(z, 1.0, 1.1)
        c = smooth(z, 1.17, 1.27)
        return {'hips': 1 - a, 'spine': a * (1 - c), 'chest': a * c}
    if tag == TAG['pelvis']:
        return {'hips': 1.0}
    if tag in (TAG['leg.L'], TAG['leg.R']):
        side = 'L' if tag == TAG['leg.L'] else 'R'
        top = smooth(z, 0.84, 0.93)  # blend into the hips at the top
        k = smooth(z, 0.44, 0.56)  # 1 = thigh, 0 = shin
        w = {f'thigh.{side}': k * (1 - top * 0.5), f'shin.{side}': 1 - k, 'hips': k * top * 0.5}
        return w
    if tag in (TAG['foot.L'], TAG['foot.R']):
        side = 'L' if tag == TAG['foot.L'] else 'R'
        return {f'foot.{side}': 1.0}
    if tag in (TAG['arm.L'], TAG['arm.R']):
        side = 'L' if tag == TAG['arm.L'] else 'R'
        top = smooth(z, 1.33, 1.41)
        k = smooth(z, 1.07, 1.17)  # 1 = upper arm
        lo = 1 - smooth(z, 0.88, 0.93)
        return {f'upper_arm.{side}': k * (1 - top * 0.4), f'forearm.{side}': (1 - k) * (1 - lo * 0.5), f'hand.{side}': (1 - k) * lo * 0.5, f'shoulder.{side}': k * top * 0.4}
    if tag in (TAG['hand.L'], TAG['hand.R']):
        side = 'L' if tag == TAG['hand.L'] else 'R'
        return {f'hand.{side}': 1.0}
    return {'chest': 1.0}


def build_props(arm):
    out = []
    # Phone in the right hand (screen towards the face when raised).
    me = bpy.data.meshes.new('Prop_Phone')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((0.012, 0.075, 0.15, 1)))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.004, segments=2, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material('prop_dark', color='#1f2329', roughness=0.35))
    for p in me.polygons:
        p.use_smooth = True
    phone = bpy.data.objects.new('Prop_Phone', me)
    bpy.context.scene.collection.objects.link(phone)
    _parent_to_bone(phone, arm, 'hand.R', Vector((-0.232, -0.045, 0.82)), Euler((0.0, 0.0, 0.0)))
    out.append(phone)
    # Document folder in the left hand.
    me = bpy.data.meshes.new('Prop_Document')
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=Matrix.Diagonal((0.012, 0.23, 0.3, 1)))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.003, segments=1, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material('prop_paper', color='#f4f1ea', roughness=0.8))
    doc = bpy.data.objects.new('Prop_Document', me)
    bpy.context.scene.collection.objects.link(doc)
    _parent_to_bone(doc, arm, 'hand.L', Vector((0.235, -0.07, 0.8)), Euler((0.0, 0.0, 0.0)))
    out.append(doc)
    return out


def _parent_to_bone(obj, arm, bone, world_pos, rot):
    obj.location = world_pos
    obj.rotation_euler = rot
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


# ---------------------------------------------------------------- poses and clips

D = math.radians
SEAT_Y = 0.125  # pelvis sits back from the seat centre (towards +Y = behind)
SEAT_DROP = -0.42  # hips lowered by 0.42 m (local Y of the hips bone points up)


def base_sit():
    return {
        'hips': {'loc': (0, SEAT_DROP, -SEAT_Y), 'rot': (D(-4), 0, 0)},
        'spine': {'rot': (D(2), 0, 0)},
        'thigh.L': {'rot': (D(86), 0, D(-3))},
        'thigh.R': {'rot': (D(86), 0, D(3))},
        'shin.L': {'rot': (D(-84), 0, 0)},
        'shin.R': {'rot': (D(-80), 0, 0)},
        'foot.L': {'rot': (D(4), 0, 0)},
        'foot.R': {'rot': (D(2), 0, 0)},
    }


def arms_rest_sit():
    return {
        'upper_arm.L': {'rot': (D(18), 0, D(-6))},
        'upper_arm.R': {'rot': (D(18), 0, D(6))},
        'forearm.L': {'rot': (D(52), D(-20), 0)},
        'forearm.R': {'rot': (D(52), D(20), 0)},
    }


def arms_rest_stand():
    return {
        'upper_arm.L': {'rot': (D(2), 0, D(-3))},
        'upper_arm.R': {'rot': (D(2), 0, D(3))},
        'forearm.L': {'rot': (D(10), 0, 0)},
        'forearm.R': {'rot': (D(10), 0, 0)},
    }


def merge(*poses):
    out = {}
    for p in poses:
        for bone, v in p.items():
            cur = out.setdefault(bone, {})
            cur.update(v)
    return out


def phone_arm():
    return {
        'upper_arm.R': {'rot': (D(38), D(-10), D(-36))},
        'forearm.R': {'rot': (D(132), D(30), 0)},
        'hand.R': {'rot': (D(-10), D(70), D(10))},
        'head': {'rot': (D(4), D(-6), D(9))},
    }


def wave_arm(t):
    s = math.sin(t * 2 * math.pi * 1.6)
    return {
        'upper_arm.R': {'rot': (D(20), 0, D(-150))},
        'forearm.R': {'rot': (D(22), 0, D(-18 + 26 * s))},
        'hand.R': {'rot': (0, D(80), D(8 * s))},
        'head': {'rot': (D(-4), D(-10), D(-4))},
    }


def clip_frames(name):
    """Returns (duration_s, keyframe times, pose_fn(t) -> pose dict)."""
    if name == 'idle':
        def f(t):
            b = math.sin(t / 4 * 2 * math.pi)
            look = math.sin(t / 4 * 2 * math.pi + 0.6)
            return merge(arms_rest_stand(), {
                'hips': {'loc': (0.01 * b, 0, 0), 'rot': (0, 0, D(1.5 * b))},
                'spine': {'rot': (D(1), 0, D(-1.2 * b))},
                'chest': {'rot': (D(1.5 + 1.2 * math.sin(t / 4 * 4 * math.pi)), 0, 0)},
                'head': {'rot': (D(2), D(12 * look), 0)},
                'thigh.L': {'rot': (0, 0, D(-1.5 * b))},
                'thigh.R': {'rot': (0, 0, D(-1.5 * b))},
            })
        return 4.0, 9, f
    if name == 'sit':
        def f(t):
            b = math.sin(t / 4 * 2 * math.pi)
            return merge(base_sit(), arms_rest_sit(), {
                'chest': {'rot': (D(2 + 1.2 * math.sin(t / 4 * 4 * math.pi)), 0, 0)},
                'head': {'rot': (D(4), D(14 * b), 0)},
            })
        return 4.0, 9, f
    if name == 'typing':
        def f(t):
            a = math.sin(t * 2 * math.pi * 3)
            c = math.sin(t * 2 * math.pi * 3 + 1.9)
            return merge(base_sit(), {
                'spine': {'rot': (D(9), 0, 0)},
                'chest': {'rot': (D(6), 0, 0)},
                'neck': {'rot': (D(6), 0, 0)},
                'head': {'rot': (D(6 + 2 * math.sin(t * 2 * math.pi)), D(4 * math.sin(t * math.pi)), 0)},
                'upper_arm.L': {'rot': (D(44), D(-10), D(-14))},
                'upper_arm.R': {'rot': (D(44), D(10), D(14))},
                'forearm.L': {'rot': (D(50 + 4 * a), D(-55), D(-10))},
                'forearm.R': {'rot': (D(50 + 4 * c), D(55), D(10))},
                'hand.L': {'rot': (D(-8 + 6 * a), 0, 0)},
                'hand.R': {'rot': (D(-8 + 6 * c), 0, 0)},
            })
        return 2.0, 25, f
    if name in ('phone_sit', 'phone_stand'):
        seated = name == 'phone_sit'
        def f(t):
            g = math.sin(t / 4 * 2 * math.pi)
            gest = max(0.0, math.sin(t / 4 * 2 * math.pi * 2))
            base = merge(base_sit(), arms_rest_sit()) if seated else merge(arms_rest_stand(), {'hips': {'loc': (0.012 * g, 0, 0), 'rot': (0, 0, D(2 * g))}})
            left = {'upper_arm.L': {'rot': (D(20 + 18 * gest), 0, D(-8))}, 'forearm.L': {'rot': (D(55 + 30 * gest), D(-30), 0)}}
            return merge(base, left, phone_arm(), {
                'spine': {'rot': (D(-3 if seated else 0), D(5 * g), 0)},
                'head': {'rot': (D(4), D(-6 + 10 * g), D(9))},
            })
        return 4.0, 13, f
    if name in ('walk', 'walk_carry'):
        carry = name == 'walk_carry'
        def f(t):
            ph = t / 1.0 * 2 * math.pi
            s = math.sin(ph)
            c = math.cos(ph)
            bob = abs(math.cos(ph))
            pose = {
                'hips': {'loc': (0, -0.025 + 0.025 * bob, 0), 'rot': (D(3), D(5 * s), D(2 * c))},
                'spine': {'rot': (D(2), D(-3 * s), 0)},
                'chest': {'rot': (D(2), D(-4 * s), 0)},
                'head': {'rot': (D(2), D(2 * s), 0)},
                'thigh.L': {'rot': (D(26 * s), 0, D(-2))},
                'thigh.R': {'rot': (D(-26 * s), 0, D(2))},
                'shin.L': {'rot': (D(-8 - 32 * max(0.0, -c) * (1 if s < 0.3 else 0.6)), 0, 0)},
                'shin.R': {'rot': (D(-8 - 32 * max(0.0, c) * (1 if s > -0.3 else 0.6)), 0, 0)},
                'foot.L': {'rot': (D(10 * max(0.0, s)), 0, 0)},
                'foot.R': {'rot': (D(10 * max(0.0, -s)), 0, 0)},
                'upper_arm.L': {'rot': (D(-20 * s), 0, D(-4))},
                'upper_arm.R': {'rot': (D(20 * s), 0, D(4))},
                'forearm.L': {'rot': (D(16 + 10 * max(0.0, -s)), 0, 0)},
                'forearm.R': {'rot': (D(16 + 10 * max(0.0, s)), 0, 0)},
            }
            if carry:
                pose.update({
                    'upper_arm.L': {'rot': (D(18), D(-10), D(-8))},
                    'forearm.L': {'rot': (D(100), D(-60), D(-10))},
                    'hand.L': {'rot': (0, D(-20), 0)},
                })
            return pose
        return 1.0, 13, f
    if name in ('wave', 'wave_sit'):
        seated = name == 'wave_sit'
        def f(t):
            base = merge(base_sit(), arms_rest_sit()) if seated else arms_rest_stand()
            return merge(base, {'chest': {'rot': (D(-2), D(-8), 0)}}, wave_arm(t))
        return 2.5, 26, f
    if name == 'sleep_sit':
        def f(t):
            b = math.sin(t / 4 * 2 * math.pi)
            return merge(base_sit(), {
                'hips': {'loc': (0, SEAT_DROP, -SEAT_Y), 'rot': (D(14), 0, 0)},
                'spine': {'rot': (D(24 + 1.5 * b), 0, 0)},
                'chest': {'rot': (D(20 + 1.5 * b), 0, 0)},
                'neck': {'rot': (D(14), 0, 0)},
                'head': {'rot': (D(18), D(-14), D(18))},
                'upper_arm.L': {'rot': (D(76), D(-20), D(-24))},
                'upper_arm.R': {'rot': (D(76), D(20), D(24))},
                'forearm.L': {'rot': (D(70), D(-70), D(-30))},
                'forearm.R': {'rot': (D(70), D(70), D(30))},
            })
        return 4.0, 9, f
    if name == 'receive_sit':
        def f(t):
            k = math.sin(min(1.0, t / 1.2) * math.pi)
            return merge(base_sit(), {
                'spine': {'rot': (D(6 + 8 * k), 0, 0)},
                'upper_arm.L': {'rot': (D(30 + 40 * k), 0, D(-10))},
                'upper_arm.R': {'rot': (D(30 + 40 * k), 0, D(10))},
                'forearm.L': {'rot': (D(50 - 20 * k), D(-60), 0)},
                'forearm.R': {'rot': (D(50 - 20 * k), D(60), 0)},
                'head': {'rot': (D(8 * k), 0, 0)},
            })
        return 1.2, 13, f
    raise ValueError(name)


CLIPS = ['idle', 'sit', 'typing', 'phone_sit', 'phone_stand', 'walk', 'walk_carry', 'wave', 'wave_sit', 'sleep_sit', 'receive_sit']


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        spec = pose.get(pb.name, {})
        pb.location = spec.get('loc', (0, 0, 0))
        pb.rotation_euler = spec.get('rot', (0, 0, 0))


def make_actions(arm):
    arm.animation_data_create()
    actions = []
    for name in CLIPS:
        dur, keys, fn = clip_frames(name)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        frames = round(dur * FPS)
        for k in range(keys):
            t = dur * k / (keys - 1)
            frame = 1 + round(frames * k / (keys - 1))
            pose = fn(t % dur if k < keys - 1 else 0.0) if name not in ('receive_sit',) else fn(t)
            apply_pose(arm, pose)
            for pb in arm.pose.bones:
                pb.keyframe_insert('rotation_euler', frame=frame)
                if pb.name == 'hips':
                    pb.keyframe_insert('location', frame=frame)
        actions.append(act)
    arm.animation_data.action = None
    apply_pose(arm, {})
    return actions


# ---------------------------------------------------------------- preview

def preview(arm, out_path):
    """Contact sheet of every clip at mid time: one render per clip, side by side."""
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.3
    cam = bpy.data.objects.new('Cam', cam_data)
    scene.collection.objects.link(cam)
    d = Vector((math.cos(D(32)) * math.sin(D(35)), -math.cos(D(32)) * math.cos(D(35)), math.sin(D(32))))
    cam.location = Vector((0, 0, 0.85)) + d * 10
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.render.resolution_x, scene.render.resolution_y = 360, 440
    scene.render.film_transparent = False
    # Chair and desk stand-ins at the template dimensions (seat 0.47, desk 0.75 at 0.62 m).
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.43))
    seat = bpy.context.active_object
    seat.scale = (0.5, 0.48, 0.08)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.62, 0.735))
    desk = bpy.context.active_object
    desk.scale = (1.4, 0.7, 0.035)
    os.makedirs(out_path, exist_ok=True)
    for name in CLIPS:
        act = bpy.data.actions[name]
        arm.animation_data.action = act
        start, end = act.frame_range
        scene.frame_set(int((start + end) / 2))
        seated = name.endswith('_sit') or name in ('sit', 'typing')
        seat.hide_render = not seated
        desk.hide_render = not seated
        scene.render.filepath = os.path.join(out_path, f'clip-{name}.png')
        bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None


VARIANTS = [
    ('Body_broad_long', 'Hair_short', '#2563eb', '#1f2937'),
    ('Body_slim_short', 'Hair_long', '#db2777', '#334155'),
    ('Body_broad_short', 'Hair_curly', '#0f766e', '#3f3f46'),
    ('Body_slim_long', 'Hair_bun', '#f59e0b', '#1e3a5f'),
    ('Body_broad_long', None, '#64748b', '#57534e'),
    ('Body_slim_short', 'Hair_short', '#10b981', '#44403c'),
]


def preview_variants(arm, objs, out_path):
    scene = bpy.context.scene
    arm.animation_data.action = bpy.data.actions['idle']
    scene.frame_set(1)
    for name in ('Cube', 'Cube.001'):
        ob = bpy.data.objects.get(name)
        if ob:
            ob.hide_render = True
    os.makedirs(out_path, exist_ok=True)
    for k, (body, hair, top, bottom) in enumerate(VARIANTS):
        for o in objs:
            o.hide_render = o.name not in (body, hair)
        bpy.data.materials['top'].diffuse_color = (*[c ** 2.2 for c in _hex(top)], 1)
        bpy.data.materials['bottom'].diffuse_color = (*[c ** 2.2 for c in _hex(bottom)], 1)
        scene.render.filepath = os.path.join(out_path, f'variant-{k}.png')
        bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None


def _hex(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def main():
    args = cli_args()
    reset_scene()
    bpy.context.scene.render.fps = FPS
    arm = build_armature()
    objs = []
    for build in ('broad', 'slim'):
        for sleeves in ('long', 'short'):
            bm, layer, mats = build_body(build, sleeves)
            objs.append(to_mesh_object(f'Body_{build}_{sleeves}', bm, layer, mats, arm, skin_weights))
    for style in ('short', 'long', 'bun', 'curly'):
        bm, layer, mats = build_hair(style)
        objs.append(to_mesh_object(f'Hair_{style}', bm, layer, mats, arm, skin_weights))
    build_props(arm)
    make_actions(arm)
    if args.get('preview'):
        for o in objs:
            o.hide_render = o.name not in ('Body_broad_short', 'Hair_short')
        preview(arm, os.path.join(OUT_TMP, 'characters'))
        preview_variants(arm, objs, os.path.join(OUT_TMP, 'variants'))
        for o in objs:
            o.hide_render = False
        for name in ('Cube', 'Cube.001'):
            ob = bpy.data.objects.get(name)
            if ob:
                bpy.data.objects.remove(ob)
    if args.get('save-blend'):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_TMP, 'characters.blend'))
    if args.get('export'):
        path = os.path.join(PUBLIC, 'characters.glb')
        bpy.ops.object.select_all(action='DESELECT')
        for o in bpy.context.scene.objects:
            if o.type in ('ARMATURE', 'MESH'):
                o.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format='GLB',
            use_selection=True,
            export_yup=True,
            export_texcoords=False,
            export_normals=True,
            export_materials='EXPORT',
            export_animations=True,
            export_animation_mode='ACTIONS',
            export_force_sampling=True,
            export_frame_step=1,
            export_optimize_animation_size=True,
            export_anim_single_armature=True,
            export_reset_pose_bones=True,
            export_skins=True,
            export_influence_nb=4,
            export_def_bones=False,
            export_leaf_bone=False,
            export_cameras=False,
            export_lights=False,
            export_extras=False,
            export_draco_mesh_compression_enable=False,
        )
        print(f'[characters] exported {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


main()
