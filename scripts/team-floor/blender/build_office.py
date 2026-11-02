"""Builds the Team Floor office GLB from a floor template (SPEC 12.1). Original, project-owned work.

  blender --background --factory-startup --python scripts/team-floor/blender/build_office.py -- \
      --template medium [--bake] [--samples 96] [--size 2048] [--preview] [--export] [--save-blend]

Stages (all in one run): build geometry from apps/web/public/team-floor/templates/<id>.json ->
lightmap UVs -> (--bake) Cycles bake of the Day lightmap and AO -> (--export) Draco GLB with WebP
textures to apps/web/public/team-floor/office-<id>.glb. Lightmaps are written next to it as
office-<id>-day.webp and office-<id>-ao.webp with office-<id>.bake.json (encoding scale, timings).
--preview renders scripts/team-floor/.out/office-<id>-preview.png from the runtime camera angle.
"""

import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))

import props as P  # noqa: E402
import textures as TX  # noqa: E402
from common import (  # noqa: E402
    OUT_TMP,
    PUBLIC,
    MeshBuilder,
    box_project_uv,
    cli_args,
    collection,
    ensure_uv,
    iso_camera,
    link_object,
    linear_to_srgb_np,
    load_template,
    place_matrix,
    reset_scene,
    rz,
    save_rgb_image,
    t2b,
)

LM_SCALE = 2.0  # lightmap texel = srgb(irradiance / LM_SCALE); runtime intensity = LM_SCALE * PI
TEX_DIR = os.path.join(OUT_TMP, 'textures')


# ---------------------------------------------------------------- textures

def make_textures():
    os.makedirs(TEX_DIR, exist_ok=True)
    specs = {
        'floor_oak': (lambda: TX.planks(1024, 2.4, 0.2, base='#c08b59', dark='#93603a', light='#dcae7a', gap='#6a4428', seed=7)),
        'floor_walnut': (lambda: TX.planks(512, 1.2, 0.15, base='#5b3b26', dark='#3d2516', light='#7a5236', gap='#2a190e', seed=13, min_len=0.6, max_len=1.1)),
        'walnut': (lambda: TX.planks(512, 1.2, 0.3, base='#5e3d28', dark='#402818', light='#7d553a', gap='#3a2416', seed=21, min_len=2.4, max_len=2.4, grain=1.1)),
        'floor_carpet': (lambda: TX.carpet(256)),
        'floor_stone': (lambda: TX.stone(256)),
        'rug_grey': (lambda: TX.rug(512)),
    }
    for name, fn in specs.items():
        path = os.path.join(TEX_DIR, f'{name}.png')
        if not os.path.exists(path):
            px = fn()
            save_rgb_image(f'tex_{name}', px, px.shape[1], px.shape[0], path)
        P.TEXTURED[name] = path


TILES = {
    'floor_oak': (2.4, 'box'),
    'floor_walnut': (1.2, 'box'),
    'walnut': (1.2, 'vertical'),
    'floor_carpet': (1.0, 'box'),
    'floor_stone': (1.2, 'box'),
}


# ---------------------------------------------------------------- architecture

def _floor_polygons(b, t):
    by_floor = {}
    for room in t['rooms']:
        by_floor.setdefault(room['floor'], []).append(room['outline'])
    mat_for = {'oak': 'floor_oak', 'carpet': 'floor_carpet', 'walnut': 'floor_walnut', 'stone': 'floor_stone'}
    for floor, outlines in by_floor.items():
        fb = MeshBuilder()
        for outline in outlines:
            fb.polygon([(x, -z) for x, z in outline], 0.0, P.mat(mat_for[floor]))
        bmesh.ops.remove_doubles(fb.bm, verts=fb.bm.verts, dist=0.001)
        if len(fb.bm.faces) > 1:
            bmesh.ops.dissolve_faces(fb.bm, faces=list(fb.bm.faces))
        # Copy faces into the static builder.
        vmap = {}
        idx = b.mi(P.mat(mat_for[floor]))
        for f in fb.bm.faces:
            verts = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = b.bm.verts.new(v.co)
                verts.append(vmap[v])
            nf = b.bm.faces.new(verts)
            nf.normal_update()
            if nf.normal.z < 0:
                nf.normal_flip()
            nf.material_index = idx
        fb.free()


def _slab(b, t, depth=0.3):
    pts = [(x, -z) for x, z in t['footprint']]
    top = [b.bm.verts.new((x, y, -0.004)) for x, y in pts]
    bot = [b.bm.verts.new((x, y, -depth)) for x, y in pts]
    idx = b.mi(P.mat('slab'))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        f = b.bm.faces.new((top[i], bot[i], bot[j], top[j]))
        f.material_index = idx
        f.normal_update()
    # Outward normals: footprint is listed clockwise in Blender (x, -z) space; flip if needed.
    center = Vector((sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, 0))
    for f in b.bm.faces[-n:]:
        c = f.calc_center_median()
        if (c - center).dot(f.normal) < 0:
            f.normal_flip()


def _wall_frame(w):
    ax, az = w['a']
    bx, bz = w['b']
    length = math.hypot(bx - ax, bz - az)
    ux, uz = (bx - ax) / length, (bz - az) / length
    # Visible side normal (towards the camera, +x +z) in template coordinates.
    nx, nz = -uz, ux
    if nx + nz < 0:
        nx, nz = uz, -ux
    xb = Vector((ux, -uz, 0))
    zb = Vector((0, 0, 1))
    yb = zb.cross(xb)
    m = Matrix((xb, yb, zb)).transposed().to_4x4()
    m.translation = t2b(ax, az, 0)
    n_b = Vector((nx, -nz, 0))
    vy = 1.0 if yb.dot(n_b) > 0 else -1.0  # local Y sign of the visible face
    return m, length, vy


def _spans(length, openings, kinds):
    """Solid spans [s0, s1] outside openings of the given kinds."""
    cuts = sorted([o for o in openings if o['kind'] in kinds], key=lambda o: o['from'])
    out = []
    cursor = 0.0
    for o in cuts:
        if o['from'] > cursor:
            out.append((cursor, o['from']))
        cursor = max(cursor, o['to'])
    if cursor < length:
        out.append((cursor, length))
    return out


def _finish_at(w, s):
    for f in w.get('finish') or []:
        if f['from'] - 1e-6 <= s <= f['to'] + 1e-6:
            return f['inner']
    return 'paint'


def build_wall(w, ctx):
    b, g = ctx.static, ctx.glass
    M, L, vy = _wall_frame(w)
    H, T = w['height'], w['thickness']
    kind = w['kind']
    openings = w.get('openings') or []
    end_ext = T / 2

    def ext(s0, s1):
        x0 = s0 - (end_ext if s0 <= 1e-6 else 0)
        x1 = s1 + (end_ext if s1 >= L - 1e-6 else 0)
        return x0, x1

    if kind in ('back', 'front', 'partition'):
        core = 'wall_slate' if kind == 'front' else 'wall_paint'
        below = 0.3 if kind != 'partition' else 0.0
        for s0, s1 in _spans(L, openings, {'door', 'gap', 'window'}):
            x0, x1 = ext(s0, s1)
            b.box((x1 - x0, T, H + below), ((x0 + x1) / 2, 0, (H - below) / 2), P.mat(core), bevel=0.008, matrix=M)
        for o in openings:
            if o['kind'] != 'window':
                continue
            s0, s1, sill, head = o['from'], o['to'], o.get('sill', 0.9), o.get('head', 2.2)
            b.box((s1 - s0, T, sill + below), ((s0 + s1) / 2, 0, (sill - below) / 2), P.mat(core), bevel=0.008, matrix=M)
            b.box((s1 - s0, T, H - head), ((s0 + s1) / 2, 0, (H + head) / 2), P.mat(core), bevel=0.008, matrix=M)
            _window(b, g, M, vy, T, s0, s1, sill, head)
        if kind == 'front':
            for s0, s1 in _spans(L, openings, {'door', 'gap'}):
                x0, x1 = ext(s0, s1)
                b.box((x1 - x0 + 0.02, T + 0.06, 0.05), ((x0 + x1) / 2, 0, H + 0.025), P.mat('wall_cap'), bevel=0.01, matrix=M)
                b.box((x1 - x0, 0.012, 0.03), ((x0 + x1) / 2, vy * (T / 2 + 0.006), H - 0.12), P.mat('wall_cap'), matrix=M)
            return
        # Inner finishes on the visible face.
        for s0, s1 in _spans(L, openings, {'door', 'gap'}):
            segs = _finish_segments(w, s0, s1)
            for f0, f1, fin in segs:
                yv = vy * (T / 2 + 0.012)
                if fin == 'paint':
                    _wainscot(b, M, vy, T, f0, f1, openings)
                elif fin == 'acoustic':
                    b.box((f1 - f0, 0.024, H - 0.3), ((f0 + f1) / 2, yv, (H - 0.3) / 2 + 0.05), P.mat('acoustic'), bevel=0.006, matrix=M)
                    n = max(1, int((f1 - f0) / 0.6))
                    for k in range(1, n):
                        x = f0 + (f1 - f0) * k / n
                        b.box((0.012, 0.03, H - 0.32), (x, vy * (T / 2 + 0.016), (H - 0.3) / 2 + 0.05), P.mat('acoustic_panel'), matrix=M)
                    b.box((f1 - f0, 0.03, 0.1), ((f0 + f1) / 2, vy * (T / 2 + 0.015), 0.05), P.mat('wall_slate'), matrix=M)
                elif fin == 'walnut':
                    _walnut_panels(b, M, vy, T, H, f0, f1, openings)
        x0, x1 = ext(0, L)
        b.box((x1 - x0 + 0.02, T + 0.05, 0.07), ((x0 + x1) / 2, 0, H + 0.035), P.mat('wall_trim'), bevel=0.012, matrix=M)
        return

    if kind in ('glass', 'glass_walnut'):
        base_h = 0.95 if kind == 'glass_walnut' else 0.0
        door_head = 2.1
        if base_h:
            for s0, s1 in _spans(L, openings, {'door', 'gap'}):
                b.box((s1 - s0, T, base_h), ((s0 + s1) / 2, 0, base_h / 2), P.mat('walnut'), bevel=0.01, matrix=M)
                b.box((s1 - s0, T + 0.03, 0.03), ((s0 + s1) / 2, 0, base_h + 0.015), P.mat('metal_dark'), matrix=M)
        # Top rail along the whole wall, bottom rail on solid spans.
        b.box((L, max(T, 0.06), 0.06), (L / 2, 0, H - 0.03), P.mat('frame_alu'), bevel=0.005, matrix=M)
        for s0, s1 in _spans(L, openings, {'door', 'gap'}):
            if not base_h:
                b.box((s1 - s0, 0.07, 0.07), ((s0 + s1) / 2, 0, 0.035), P.mat('frame_alu'), bevel=0.005, matrix=M)
            n = max(1, round((s1 - s0) / 1.25))
            for k in range(n + 1):
                x = s0 + (s1 - s0) * k / n
                b.box((0.05, 0.07, H - base_h), (x, 0, base_h + (H - base_h) / 2), P.mat('frame_alu'), bevel=0.004, matrix=M)
            g.box((s1 - s0 - 0.04, 0.012, H - base_h - 0.1), ((s0 + s1) / 2, 0, base_h + (H - base_h) / 2), P.mat('glass'), matrix=M)
        for o in openings:
            if o['kind'] == 'door':
                b.box((o['to'] - o['from'], 0.07, 0.06), ((o['from'] + o['to']) / 2, 0, door_head), P.mat('frame_alu'), matrix=M)
                g.box((o['to'] - o['from'] - 0.04, 0.012, H - door_head - 0.1), ((o['from'] + o['to']) / 2, 0, (H + door_head) / 2), P.mat('glass'), matrix=M)
        return


def _finish_segments(w, s0, s1):
    fins = w.get('finish') or [{'from': 0, 'to': 1e9, 'inner': 'paint'}]
    out = []
    for f in fins:
        a, c = max(s0, f['from']), min(s1, f['to'])
        if c - a > 1e-3:
            out.append((a, c, f['inner']))
    return out


def _wainscot(b, M, vy, T, f0, f1, openings):
    yv = vy * (T / 2 + 0.01)
    b.box((f1 - f0, 0.02, 0.95), ((f0 + f1) / 2, yv, 0.475), P.mat('wall_teal'), matrix=M)
    b.box((f1 - f0, 0.045, 0.05), ((f0 + f1) / 2, vy * (T / 2 + 0.02), 0.97), P.mat('wall_trim'), bevel=0.01, matrix=M)
    b.box((f1 - f0, 0.035, 0.11), ((f0 + f1) / 2, vy * (T / 2 + 0.017), 0.055), P.mat('wall_slate'), bevel=0.005, matrix=M)


def _walnut_panels(b, M, vy, T, H, f0, f1, openings):
    windows = [o for o in openings if o['kind'] == 'window' and o['to'] > f0 and o['from'] < f1]
    cuts = [(f0, f1)]
    for o in windows:
        nxt = []
        for a, c in cuts:
            if o['to'] <= a or o['from'] >= c:
                nxt.append((a, c))
                continue
            if o['from'] > a:
                nxt.append((a, o['from']))
            if o['to'] < c:
                nxt.append((o['to'], c))
            # Below the sill and above the head.
            b.box((o['to'] - o['from'], 0.03, o.get('sill', 0.9)), ((o['from'] + o['to']) / 2, vy * (T / 2 + 0.015), o.get('sill', 0.9) / 2), P.mat('walnut'), matrix=M)
            b.box((o['to'] - o['from'], 0.03, H - o.get('head', 2.2) - 0.1), ((o['from'] + o['to']) / 2, vy * (T / 2 + 0.015), (H + o.get('head', 2.2) - 0.1) / 2), P.mat('walnut'), matrix=M)
        cuts = nxt
    for a, c in cuts:
        n = max(1, round((c - a) / 0.6))
        for k in range(n):
            x0 = a + (c - a) * k / n
            x1 = a + (c - a) * (k + 1) / n
            b.box((x1 - x0 - 0.012, 0.03, H - 0.16), ((x0 + x1) / 2, vy * (T / 2 + 0.015), (H - 0.16) / 2 + 0.06), P.mat('walnut'), bevel=0.006, matrix=M)
    b.box((f1 - f0, 0.04, 0.08), ((f0 + f1) / 2, vy * (T / 2 + 0.02), 0.04), P.mat('wall_slate'), matrix=M)


def _window(b, g, M, vy, T, s0, s1, sill, head):
    fw = 0.06
    yv = vy * (T / 2 + 0.01)
    w = s1 - s0
    cx = (s0 + s1) / 2
    for z in (sill + fw / 2, head - fw / 2):
        b.box((w, T + 0.04, fw), (cx, 0, z), P.mat('wall_trim'), bevel=0.008, matrix=M)
    for x in (s0 + fw / 2, s1 - fw / 2):
        b.box((fw, T + 0.04, head - sill), (x, 0, (sill + head) / 2), P.mat('wall_trim'), bevel=0.008, matrix=M)
    n = max(1, round(w / 1.1))
    for k in range(1, n):
        x = s0 + w * k / n
        b.box((0.04, 0.05, head - sill), (x, 0, (sill + head) / 2), P.mat('wall_trim'), matrix=M)
    b.box((w, 0.05, 0.035), (cx, 0, sill + (head - sill) * 0.62), P.mat('wall_trim'), matrix=M)
    b.box((w + 0.12, 0.16, 0.04), (cx, vy * (T / 2 + 0.06), sill - 0.02), P.mat('wall_trim'), bevel=0.01, matrix=M)
    g.box((w - 0.08, 0.01, head - sill - 0.08), (cx, 0, (sill + head) / 2), P.mat('window_glass'), matrix=M)


def build_hub_screen(ctx, col):
    if not ctx.hub_screen:
        return None
    M, r, z0, width_angle_m, h = ctx.hub_screen
    half = (width_angle_m / r) / 2
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    seg = 12
    rows = []
    for j in range(2):
        row = []
        for i in range(seg + 1):
            a = -half + 2 * half * i / seg - math.pi / 2
            row.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z0 + h * j)))
        rows.append(row)
    for i in range(seg):
        f = bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
        f.smooth = True
        for loop, (u, v) in zip(f.loops, ((i / seg, 0), ((i + 1) / seg, 0), ((i + 1) / seg, 1), (i / seg, 1))):
            loop[uv].uv = (u, v)
    bm.normal_update()
    for f in bm.faces:
        c = f.calc_center_median()
        if Vector((c.x, c.y, 0)).dot(f.normal) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('hub_screen')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(P.mat('hub_screen'))
    return link_object('hub_screen', me, col, M)


def build(t):
    ctx = P.BuildContext()
    _slab(ctx.static, t)
    _floor_polygons(ctx.static, t)
    # Porch outside the entrance (stone landing under the mat).
    ent = t['entrance']
    ox, oz = ent['outside']
    ctx.static.box((2.4, 1.5, 0.06), (ox, -(oz - 0.15), -0.03), P.mat('floor_stone'), bevel=0.01)
    ctx.static.box((2.6, 1.7, 0.24), (ox, -(oz - 0.15), -0.18), P.mat('slab'), bevel=0.01)
    for w in t['walls']:
        build_wall(w, ctx)

    inst = {}
    counters = {}
    screens = []
    for p in t['props']:
        x, z = p['pos']
        M = place_matrix(x, z, p.get('y', 0.0), p['facing'])
        if p['type'] in P.INSTANCED:
            key = P.instanced_mesh_key(p)
            counters[key] = counters.get(key, 0) + 1
            inst.setdefault(key, []).append((M, p))
            if p['type'] == 'monitor' and p.get('screen'):
                screens.append((p['screen'], M, p.get('variant', '')))
            continue
        fn = P.STATIC_BUILDERS.get(p['type'])
        if fn is None:
            print(f'[office] no builder for prop type {p["type"]}, skipped')
            continue
        fn(p, M, ctx)

    root = collection('Office')
    statics = collection('Static', root)
    instances = collection('Instances', root)
    anchors = collection('Anchors', root)

    objs = {}
    for name, builder in (('office_static', ctx.static), ('office_glass', ctx.glass), ('office_emissive', ctx.emissive)):
        if not builder.bm.faces:
            continue
        me = builder.to_mesh(name)
        builder.free()
        objs[name] = link_object(name, me, statics)

    # UV0 for textured materials (world box projection; rugs keep their own UVs).
    st = objs['office_static']
    ensure_uv(st.data, 'UVMap')
    box_project_uv(st.data, 'UVMap', TILES)

    # Instanced props: one mesh per variant, many objects.
    for key, items in inst.items():
        b = MeshBuilder()
        P.build_instanced_mesh(key, b)
        if not b.bm.faces:
            b.free()
            continue
        me = b.to_mesh(f'inst_{key}')
        b.free()
        for k, (M, p) in enumerate(items):
            link_object(f'inst:{key}:{k}', me, instances, M)

    # Screens: one quad per seat (UV 0..1 for the runtime screen texture), named screen:<seatId>.
    for sid, M, variant in screens:
        w, h = P.screen_size(variant)
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        y = -0.0172
        z0 = 0.13
        vs = [bm.verts.new(c) for c in ((-w / 2, y, z0), (w / 2, y, z0), (w / 2, y, z0 + h), (-w / 2, y, z0 + h))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
        for loop in f.loops:
            co = loop.vert.co
            loop[uv].uv = ((co.x + w / 2) / w, (co.z - z0) / h)
        me = bpy.data.meshes.new(f'screen_{sid}')
        bm.to_mesh(me)
        bm.free()
        me.materials.append(P.mat('emissive_screen'))
        link_object(f'screen:{sid}', me, instances, M)

    build_hub_screen(ctx, instances)

    for s in t['seats']:
        e = bpy.data.objects.new(f'seat:{s["id"]}', None)
        e.empty_display_size = 0.2
        anchors.objects.link(e)
        e.matrix_world = place_matrix(s['pos'][0], s['pos'][1], 0, s['facing'])
    e = bpy.data.objects.new('anchor:hub', None)
    anchors.objects.link(e)
    e.location = t2b(t['hub']['pos'][0], t['hub']['pos'][1], 0)
    return objs


# ---------------------------------------------------------------- culling and lightmap UVs

def cull_backfaces(obj, cam_dir):
    """Delete faces that can never face the fixed isometric camera (no orbit)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    dead = [f for f in bm.faces if f.normal.dot(cam_dir) < -0.02]
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bm.to_mesh(me)
    bm.free()
    return len(dead)


def lightmap_uv(obj, margin=0.0035):
    me = obj.data
    ensure_uv(me, 'Lightmap')
    me.uv_layers.active = me.uv_layers['Lightmap']
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    weight_islands(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, scale=True, margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']


FLOOR_MATS = {'floor_oak', 'floor_walnut', 'floor_carpet', 'floor_stone', 'rug_grey'}
WALL_MATS = {'wall_paint', 'wall_teal', 'walnut', 'acoustic', 'wall_slate'}


def weight_islands(obj):
    """Give the floor (most of the screen) and walls more lightmap texels than small furniture parts:
    scale each UV island about its centre before packing (packing keeps relative island sizes)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    uv = bm.loops.layers.uv['Lightmap']
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for e in bm.edges:
        if len(e.link_faces) != 2:
            continue
        f1, f2 = e.link_faces
        l1 = next(l for l in f1.loops if l.edge == e)
        l2 = next(l for l in f2.loops if l.edge == e)
        if (l1[uv].uv - l2.link_loop_next[uv].uv).length < 1e-6 and (l1.link_loop_next[uv].uv - l2[uv].uv).length < 1e-6:
            a, b = find(f1.index), find(f2.index)
            if a != b:
                parent[a] = b
    names = [m.name if m else '' for m in me.materials]
    weight = {}
    for f in bm.faces:
        name = names[f.material_index] if f.material_index < len(names) else ''
        w = 1.0
        if name in FLOOR_MATS and f.normal.z > 0.9:
            w = 2.3
        elif name in WALL_MATS and abs(f.normal.z) < 0.2 and f.calc_area() > 0.25:
            w = 1.35
        elif f.calc_area() < 0.004:
            w = 0.7
        r = find(f.index)
        weight[r] = max(weight.get(r, 0.0), w)
    islands = {}
    for f in bm.faces:
        islands.setdefault(find(f.index), []).append(f)
    for r, faces in islands.items():
        w = weight.get(r, 1.0)
        if abs(w - 1.0) < 1e-3:
            continue
        loops = [l for f in faces for l in f.loops]
        cx = sum(l[uv].uv.x for l in loops) / len(loops)
        cy = sum(l[uv].uv.y for l in loops) / len(loops)
        for l in loops:
            l[uv].uv.x = cx + (l[uv].uv.x - cx) * w
            l[uv].uv.y = cy + (l[uv].uv.y - cy) * w
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------- lighting (Day and Evening)

LIT_VARIANTS = ('day', 'evening')
WARM = (1.0, 0.78, 0.52)
WARM_EVENING = (1.0, 0.7, 0.42)
COOL_WINDOW = (0.42, 0.58, 1.0)
# Emission strengths per variant (the evening screens, lamps and hub light their surroundings).
EMISSION = {
    'day': {'emissive_screen': 1.2, 'emissive_lamp': 5.0, 'emissive_hub': 9.0, 'emissive_hub_soft': 2.5, 'emissive_reception': 16.0, 'hub_screen': 1.0},
    'evening': {'emissive_screen': 7.0, 'emissive_lamp': 14.0, 'emissive_hub': 14.0, 'emissive_hub_soft': 4.0, 'emissive_reception': 22.0, 'hub_screen': 3.0},
}


def _lights_collection(scene):
    col = bpy.data.collections.get('Lights')
    if col is None:
        col = bpy.data.collections.new('Lights')
        scene.collection.children.link(col)
    for o in list(col.objects):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if data is not None and data.users == 0:
            bpy.data.lights.remove(data)
    return col


def _add_light(col, name, kind, energy, color, location, size=0.12, rotation=None, spot=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind == 'AREA':
        ld.shape = 'RECTANGLE'
        ld.size, ld.size_y = size
    elif kind != 'SUN':
        ld.shadow_soft_size = size
    if spot:
        ld.spot_size, ld.spot_blend = spot
    lo = bpy.data.objects.new(name, ld)
    col.objects.link(lo)
    lo.location = location
    if rotation is not None:
        lo.rotation_euler = rotation
    return lo


def _set_emission(variant):
    for name, strength in EMISSION[variant].items():
        m = bpy.data.materials.get(name)
        if m is None:
            continue
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf is not None:
            bsdf.inputs['Emission Strength'].default_value = strength


def _windows(t):
    """(centre, inward normal, width, height) of every window, in Blender coordinates."""
    out = []
    for w in t['walls']:
        for o in w.get('openings') or []:
            if o['kind'] != 'window':
                continue
            M, L, vy = _wall_frame(w)
            s = (o['from'] + o['to']) / 2
            z = (o.get('sill', 0.9) + o.get('head', 2.2)) / 2
            centre = M @ Vector((s, 0, z))
            inward = (M.to_3x3() @ Vector((0, vy, 0))).normalized()
            out.append((centre, inward, o['to'] - o['from'], o.get('head', 2.2) - o.get('sill', 0.9)))
    return out


def setup_lighting(scene, t, variant):
    """Day: warm sun from the upper left plus soft sky. Evening: deep navy sky, a faint cool moon,
    cool blue light through the windows, warm downlight pools and lamps, glowing monitors."""
    col = _lights_collection(scene)
    world = bpy.data.worlds.get('BakeWorld') or bpy.data.worlds.new('BakeWorld')
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes.get('Background')
    evening = variant == 'evening'
    if evening:
        bg.inputs['Color'].default_value = (0.06, 0.085, 0.2, 1.0)
        bg.inputs['Strength'].default_value = 0.32
    else:
        bg.inputs['Color'].default_value = (0.78, 0.85, 0.96, 1.0)
        bg.inputs['Strength'].default_value = 0.55
    # Warm daylight travels towards template +x (shadows fall to the screen right). Must match
    # SUN_TRAVEL in apps/web/features/team-floor/scene/engine.ts (three (1, -1.15, 0.12)).
    travel = Vector((1.0, -0.12, -1.15)).normalized()
    sun = _add_light(col, 'Sun', 'SUN', 0.22 if evening else 1.7, (0.6, 0.7, 1.0) if evening else (1.0, 0.93, 0.83), (0, 0, 20), rotation=travel.to_track_quat('-Z', 'Y').to_euler())
    sun.data.angle = math.radians(14 if evening else 8)
    energies = {
        'day': {'sconce': 14, 'sconce_outdoor': 8, 'floor_lamp': 30, 'desk_lamp': 8},
        'evening': {'sconce': 26, 'sconce_outdoor': 16, 'floor_lamp': 70, 'desk_lamp': 18},
    }[variant]
    for p in t['props']:
        if p['type'] in energies:
            x, z = p['pos']
            fx, fz = math.sin(math.radians(p['facing'])), math.cos(math.radians(p['facing']))
            y = p.get('y', 0) + (1.4 if p['type'] == 'floor_lamp' else 0.3 if p['type'] == 'desk_lamp' else 0)
            off = 0.18 if p['type'].startswith('sconce') else 0.0
            _add_light(col, f'L_{p["type"]}', 'POINT', energies[p['type']], WARM_EVENING if evening else WARM, t2b(x + fx * off, z + fz * off, y))
    if evening:
        # Warm downlight pools from the (cut-away) ceiling at the template lamp positions.
        for k, lamp in enumerate(t.get('lamps') or []):
            if lamp['kind'] != 'pendant':
                continue
            x, y, z = lamp['pos']
            _add_light(col, f'Down_{k}', 'SPOT', 230, WARM_EVENING, t2b(x, z, y + 0.2), size=0.35, rotation=(0, 0, 0), spot=(math.radians(100), 0.9))
        # Cool evening light through every window, aimed into the room and slightly down.
        for k, (centre, inward, width, height) in enumerate(_windows(t)):
            pos = centre - inward * 0.35
            aim = (inward + Vector((0, 0, -0.55))).normalized()
            _add_light(col, f'Window_{k}', 'AREA', 90 * width * height, COOL_WINDOW, pos, size=(width, height), rotation=aim.to_track_quat('-Z', 'Y').to_euler())
    _set_emission(variant)
    return sun


# ---------------------------------------------------------------- bake

def _bake_setup(scene, samples):
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_denoising = False
    cy.max_bounces = 4
    cy.diffuse_bounces = 3
    cy.glossy_bounces = 1
    cy.transmission_bounces = 4
    cy.transparent_max_bounces = 8
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.sample_clamp_direct = 6.0
    cy.sample_clamp_indirect = 2.5
    scene.render.bake.margin = 6
    scene.render.bake.use_clear = True


def bake(obj, scene, t, size, samples, out_prefix, variants=LIT_VARIANTS):
    """Bakes each lit variant (diffuse irradiance, direct + indirect) and one AO map into the
    Lightmap UVs of `obj`. Lit maps are stored as srgb(irradiance / scale): Day uses LM_SCALE, the
    darker Evening map picks its own scale from the 99th percentile so its 8 bits go to the dark\n    majority (the brightest 1%, next to lamps and emissives, clips to white)."""
    import numpy as np
    _bake_setup(scene, samples)
    cy = scene.cycles
    me = obj.data
    me.uv_layers.active = me.uv_layers['Lightmap']
    kinds = [*variants, 'ao']
    images = {}
    for kind in kinds:
        img = bpy.data.images.new(f'bake_{kind}', size, size, alpha=False, float_buffer=True)
        img.colorspace_settings.name = 'Linear Rec.709'
        images[kind] = img
    nodes = []
    for m in me.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage')
        n.name = 'BAKE_TARGET'
        n.location = (600, 400)
        nodes.append((nt, n))

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    timings = {}
    for kind in kinds:
        for nt, n in nodes:
            n.image = images[kind]
            nt.nodes.active = n
        t0 = time.time()
        if kind == 'ao':
            setup_lighting(scene, t, 'day')
            scene.world.light_settings.distance = 0.9
            cy.samples = max(32, samples // 2)
            bpy.ops.object.bake(type='AO', margin=6, use_clear=True, target='IMAGE_TEXTURES')
            cy.samples = samples
        else:
            setup_lighting(scene, t, kind)
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=6, use_clear=True, target='IMAGE_TEXTURES')
        timings[kind] = round(time.time() - t0, 1)
        print(f'[office] baked {kind} in {timings[kind]} s')

    for nt, n in nodes:
        nt.nodes.remove(n)
    me.uv_layers.active = me.uv_layers['UVMap']
    setup_lighting(scene, t, 'day')

    out = {}
    for kind, img in images.items():
        px = np.empty(size * size * 4, np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(size, size, 4)
        rgb = px[..., :3]
        if kind == 'ao':
            rgb = _denoise(rgb, strength=1)
            enc = np.clip(rgb, 0, 1)
            stats = {'p50': float(np.percentile(rgb, 50))}
        else:
            rgb = _denoise(rgb)
            lum = rgb.mean(axis=2)
            scale = LM_SCALE if kind == 'day' else max(0.5, round(float(np.percentile(lum, 99.0)) * 1.05, 2))
            stats = {'scale': scale, 'p50': float(np.percentile(lum, 50)), 'p99': float(np.percentile(lum, 99))}
            enc = linear_to_srgb_np(rgb / scale)
        res = np.ones((size, size, 4), np.float32)
        res[..., :3] = enc
        path = f'{out_prefix}-{kind}.webp'
        save_rgb_image(f'save_{kind}', res, size, size, path, fmt='WEBP', quality=82 if kind == 'ao' else 88)
        out[kind] = {'file': os.path.basename(path), 'bytes': os.path.getsize(path), **stats}
    return out, timings


def _denoise(rgb, strength=2):
    """Light box blur to remove Monte Carlo grain (lightmaps are low frequency)."""
    import numpy as np
    out = rgb.copy()
    for _ in range(strength):
        acc = out.copy()
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            acc += np.roll(np.roll(out, dy, axis=0), dx, axis=1)
        out = acc / 5.0
    # Keep sharp contact edges: blend towards the raw value where neighbours differ a lot.
    diff = np.abs(out - rgb).mean(axis=2, keepdims=True)
    k = np.clip(diff * 4.0, 0, 0.6)
    return out * (1 - k) + rgb * k


# ---------------------------------------------------------------- preview and export

def preview(scene, t, path, engine='CYCLES', samples=48):
    iso_camera(t, resolution=(1600, 1000))
    scene.render.engine = engine
    if engine == 'CYCLES':
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.cycles.device = 'CPU'
    else:
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'MATERIAL'
    try:
        scene.view_settings.view_transform = 'Khronos PBR Neutral'
    except TypeError:
        scene.view_settings.view_transform = 'Standard'
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f'[office] preview -> {path}')


def export(t, path):
    bpy.ops.object.select_all(action='DESELECT')
    office = bpy.data.collections['Office']
    for o in office.all_objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=80,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )
    print(f'[office] exported {path} ({os.path.getsize(path) / 1e6:.2f} MB)')


def stats(objs):
    out = {}
    for o in bpy.data.collections['Office'].all_objects:
        if o.type != 'MESH':
            continue
        key = o.name.split(':')[0] + (':' + o.name.split(':')[1] if o.name.startswith('inst:') else '')
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        e = out.setdefault(key, {'objects': 0, 'tris': 0})
        e['objects'] += 1
        e['tris'] += tris
    return out


def main():
    args = cli_args()
    tid = args.get('template', 'medium')
    size = int(args.get('size', 2048))
    samples = int(args.get('samples', 96))
    t = load_template(tid)
    t0 = time.time()
    scene = reset_scene()
    make_textures()
    objs = build(t)
    cam = t['camera']
    yaw, pitch = math.radians(cam['yawDeg']), math.radians(cam['pitchDeg'])
    cam_dir = Vector((math.cos(pitch) * math.sin(yaw), -math.cos(pitch) * math.cos(yaw), math.sin(pitch)))
    culled = cull_backfaces(objs['office_static'], cam_dir)
    lightmap_uv(objs['office_static'])
    setup_lighting(scene, t, 'day')
    build_s = round(time.time() - t0, 1)
    print(f'[office] built in {build_s} s, culled {culled} back faces')

    os.makedirs(OUT_TMP, exist_ok=True)
    prefix = os.path.join(PUBLIC, f'office-{tid}')
    meta_path = f'{prefix}.bake.json'
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
    meta.update({'template': tid, 'lightmapScale': LM_SCALE, 'size': size, 'buildSeconds': build_s, 'stats': stats(objs)})
    if args.get('bake'):
        variants = tuple(v for v in str(args.get('variants', ','.join(LIT_VARIANTS))).split(',') if v in LIT_VARIANTS)
        maps, timings = bake(objs['office_static'], scene, t, size, samples, prefix, variants)
        meta.update({'maps': maps, 'bakeSeconds': timings, 'samples': samples, 'bakedAt': time.strftime('%Y-%m-%dT%H:%M:%S')})
    if args.get('preview'):
        light = args.get('light', 'day')
        setup_lighting(scene, t, light)
        engine = 'CYCLES' if args.get('preview') != 'workbench' else 'BLENDER_WORKBENCH'
        preview(scene, t, os.path.join(OUT_TMP, f'office-{tid}-{light}-preview.png'), engine=engine, samples=int(args.get('preview-samples', 48)))
    if args.get('save-blend'):
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_TMP, f'office-{tid}.blend'))
    if args.get('export'):
        export(t, f'{prefix}.glb')
        meta['glbBytes'] = os.path.getsize(f'{prefix}.glb')
    if args.get('bake') or args.get('export'):
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=1)
    print(f'[office] done in {round(time.time() - t0, 1)} s')


main()
