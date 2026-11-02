"""Prop builders for the Team Floor office (original, project-owned geometry).

Every builder receives the template prop dict, the world matrix M (template position, mount height,
heading) and a BuildContext. Builders model in prop-local space: front = -Y, up = +Z, metres.
Static props go into ctx.static (baked lightmap), glass into ctx.glass, glowing parts into
ctx.emissive. Instanced props (chairs, monitors, plants) are built once per variant as shared mesh
data and linked as separate objects (the runtime turns them into InstancedMesh).
"""

import math
import random

from mathutils import Matrix, Vector

from common import MeshBuilder, material

PI = math.pi

# ---------------------------------------------------------------- palette (sRGB hex)

MATS = {
    'wall_paint': dict(color='#efe8dc', roughness=0.9),
    'wall_teal': dict(color='#2d5a5f', roughness=0.85),
    'wall_slate': dict(color='#3a5560', roughness=0.85),
    'wall_trim': dict(color='#f5f1e9', roughness=0.7),
    'wall_cap': dict(color='#d9d3c9', roughness=0.8),
    'slab': dict(color='#2a3640', roughness=0.9),
    'acoustic': dict(color='#66737f', roughness=1.0),
    'acoustic_panel': dict(color='#4f5d6a', roughness=1.0),
    'desk_white': dict(color='#f2f1ee', roughness=0.55),
    'desk_grey': dict(color='#dcdad5', roughness=0.6),
    'oak_light': dict(color='#c89a6a', roughness=0.6),
    'fabric_dark': dict(color='#2a2e35', roughness=0.95),
    'fabric_grey': dict(color='#6b737c', roughness=0.95),
    'leather_dark': dict(color='#2b2523', roughness=0.55),
    'metal_dark': dict(color='#3a3f47', roughness=0.4, metallic=0.6),
    'metal_light': dict(color='#b4bcc5', roughness=0.35, metallic=0.7),
    'frame_alu': dict(color='#5a6470', roughness=0.4, metallic=0.5),
    'sofa_green': dict(color='#2f6a56', roughness=0.95),
    'sofa_green_light': dict(color='#3b7c65', roughness=0.95),
    'plastic_white': dict(color='#eef0f2', roughness=0.45),
    'plastic_grey': dict(color='#c4c9cf', roughness=0.5),
    'plastic_dark': dict(color='#23272e', roughness=0.45),
    'marble': dict(color='#f1efea', roughness=0.35),
    'whiteboard': dict(color='#fbfbfa', roughness=0.25),
    'sticky_yellow': dict(color='#f6d54a', roughness=0.8),
    'sticky_pink': dict(color='#f39ab4', roughness=0.8),
    'sticky_blue': dict(color='#8fd0f2', roughness=0.8),
    'sticky_green': dict(color='#a5e09a', roughness=0.8),
    'sticky_orange': dict(color='#f6b26b', roughness=0.8),
    'ink_dark': dict(color='#3b4452', roughness=0.8),
    'ink_blue': dict(color='#3d63b8', roughness=0.8),
    'paper': dict(color='#f7f6f2', roughness=0.9),
    'mat_dark': dict(color='#3a3f44', roughness=1.0),
    'leaf_a': dict(color='#3f8f4f', roughness=0.8),
    'leaf_b': dict(color='#2e7741', roughness=0.8),
    'leaf_c': dict(color='#5aa45a', roughness=0.8),
    'pot_white': dict(color='#ebe8e3', roughness=0.6),
    'pot_terracotta': dict(color='#b9693f', roughness=0.85),
    'pot_dark': dict(color='#3b4149', roughness=0.6),
    'pot_concrete': dict(color='#a8a49d', roughness=0.95),
    'soil': dict(color='#4a3626', roughness=1.0),
    'book_red': dict(color='#b04a3c', roughness=0.8),
    'book_blue': dict(color='#3f6ea8', roughness=0.8),
    'book_cream': dict(color='#e6d8b8', roughness=0.8),
    'book_green': dict(color='#4e7d5b', roughness=0.8),
    'book_brown': dict(color='#8c5a3c', roughness=0.8),
    'book_navy': dict(color='#2f3e5c', roughness=0.8),
    'book_mustard': dict(color='#c9a227', roughness=0.8),
    'art_canvas': dict(color='#f3efe2', roughness=0.9),
    'art_terra': dict(color='#df7a5e', roughness=0.9),
    'art_sand': dict(color='#f1cb8e', roughness=0.9),
    'art_sage': dict(color='#81b29a', roughness=0.9),
    'art_ink': dict(color='#3d405b', roughness=0.9),
    'art_sky': dict(color='#a8c6dc', roughness=0.9),
    'art_hill': dict(color='#6a994e', roughness=0.9),
    'art_hill_light': dict(color='#a7c957', roughness=0.9),
    'art_frame_dark': dict(color='#2b2724', roughness=0.6),
    'water_blue': dict(color='#7fb6e6', roughness=0.1, alpha=0.75),
    'hub_body': dict(color='#e2e6eb', roughness=0.35, metallic=0.2),
    'hub_dark': dict(color='#1d2530', roughness=0.4, metallic=0.3),
    'hub_platform': dict(color='#c9d0d8', roughness=0.4, metallic=0.25),
    'hub_platform_dark': dict(color='#2b3440', roughness=0.4, metallic=0.2),
    'blind': dict(color='#d8d3ca', roughness=0.8),
    # Textured (images assigned by build_office.py; colours are the untextured fallback).
    'floor_oak': dict(color='#b47c4e', roughness=0.6),
    'floor_walnut': dict(color='#5b3b26', roughness=0.55),
    'floor_carpet': dict(color='#8d97a2', roughness=1.0),
    'floor_stone': dict(color='#c9c6c0', roughness=0.9),
    'walnut': dict(color='#5e3d28', roughness=0.5),
    'rug_grey': dict(color='#7b828b', roughness=1.0),
    # Glass and emissive materials: names are a contract with the runtime (scene/office.ts).
    'glass': dict(color='#cfe4ef', roughness=0.05, alpha=0.16),
    'glass_hub': dict(color='#9cc4f6', roughness=0.05, alpha=0.35),
    'window_glass': dict(color='#d3e6f3', roughness=0.05, alpha=0.3),
    'emissive_screen': dict(color='#9cc2ff', roughness=0.3, emission='#9cc2ff', emission_strength=1.2),
    'emissive_hub': dict(color='#3b82f6', roughness=0.3, emission='#3b82f6', emission_strength=9.0),
    'emissive_hub_soft': dict(color='#7fb0ff', roughness=0.3, emission='#7fb0ff', emission_strength=2.5),
    'emissive_reception': dict(color='#4d6dff', roughness=0.3, emission='#4d6dff', emission_strength=16.0),
    'emissive_lamp': dict(color='#ffd59c', roughness=0.5, emission='#ffd59c', emission_strength=5.0),
    'hub_screen': dict(color='#16233a', roughness=0.3, emission='#2b5fd9', emission_strength=1.0),
}

TEXTURED = {}  # filled by build_office.py: material name -> image path

INSTANCED = {'chair_office', 'chair_exec', 'chair_visitor', 'monitor', 'plant_tall', 'plant_medium', 'plant_floor_small', 'plant_desk', 'desk_mug'}


def mat(name):
    spec = dict(MATS.get(name, {}))
    if name in TEXTURED:
        spec['image'] = TEXTURED[name]
    return material(name, **spec)


class BuildContext:
    def __init__(self):
        self.static = MeshBuilder()
        self.glass = MeshBuilder()
        self.emissive = MeshBuilder()
        self.instances = []  # (mesh_key, builder_fn, matrix, name)
        self.screens = []  # (screen_id, matrix, width, height)
        self.hub_screen = None


# ---------------------------------------------------------------- small helpers

def T(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def R(a, axis='Z'):
    return Matrix.Rotation(a, 4, axis)


def legs4(b, M, w, d, h, r, matname, inset=0.05):
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(r, h, (sx * (w / 2 - inset), sy * (d / 2 - inset), h / 2), matname, segments=8, matrix=M)


# ---------------------------------------------------------------- desks

def desk_white(p, M, ctx):
    b = ctx.static
    w, d, h = 1.4, 0.7, 0.75
    top = 0.035
    b.box((w, d, top), (0, 0, h - top / 2), mat('desk_white'), bevel=0.012, matrix=M)
    side = -1 if p.get('variant', 'left') == 'left' else 1
    # Drawer pedestal on one side, panel leg on the other.
    px = side * (w / 2 - 0.25)
    b.box((0.42, 0.6, h - top - 0.02), (px, 0.02, (h - top - 0.02) / 2 + 0.01), mat('desk_grey'), bevel=0.01, matrix=M)
    for k in range(3):
        dz = 0.1 + k * 0.19
        b.box((0.38, 0.012, 0.16), (px, -0.285, dz + 0.08), mat('desk_white'), bevel=0.004, matrix=M)
        b.box((0.12, 0.016, 0.014), (px, -0.296, dz + 0.13), mat('metal_dark'), matrix=M)
    b.box((0.035, 0.62, h - top), (-side * (w / 2 - 0.04), 0.0, (h - top) / 2), mat('desk_white'), bevel=0.006, matrix=M)
    b.box((w - 0.5, 0.018, 0.32), (-side * 0.2, 0.3, h - top - 0.2), mat('desk_grey'), bevel=0.004, matrix=M)
    # Keyboard and mouse.
    b.box((0.42, 0.14, 0.018), (-0.04, -0.13, h + 0.009), mat('plastic_dark'), bevel=0.004, matrix=M)
    b.box((0.05, 0.08, 0.02), (0.26, -0.12, h + 0.01), mat('plastic_dark'), bevel=0.008, matrix=M)
    # Paper stack or notepad.
    rng = random.Random(int(p['pos'][0] * 131 + p['pos'][1] * 17))
    if rng.random() < 0.6:
        b.box((0.21, 0.28, 0.02), (side * 0.5, -0.12, h + 0.01), mat('paper'), rot=(0, 0, rng.uniform(-0.3, 0.3)), matrix=M)


def desk_booth(p, M, ctx):
    b = ctx.static
    w, d, h = 1.3, 0.6, 0.75
    b.box((w, d, 0.035), (0, 0, h - 0.0175), mat('oak_light'), bevel=0.01, matrix=M)
    for sx in (-1, 1):
        b.box((0.03, d, h - 0.035), (sx * (w / 2 - 0.02), 0, (h - 0.035) / 2), mat('desk_white'), bevel=0.005, matrix=M)
    b.box((0.4, 0.13, 0.018), (-0.03, -0.12, h + 0.009), mat('plastic_dark'), bevel=0.004, matrix=M)
    b.box((0.18, 0.24, 0.02), (0.42, -0.08, h + 0.01), mat('paper'), matrix=M)


def desk_walnut(p, M, ctx):
    b = ctx.static
    w, d, h = 1.8, 0.8, 0.76
    b.box((w, d, 0.05), (0, 0, h - 0.025), mat('walnut'), bevel=0.014, matrix=M)
    for sx in (-1, 1):
        b.box((0.06, d - 0.04, h - 0.05), (sx * (w / 2 - 0.05), 0, (h - 0.05) / 2), mat('walnut'), bevel=0.01, matrix=M)
    # Modesty panel on the visitor side (+Y local).
    b.box((w - 0.16, 0.03, 0.5), (0, d / 2 - 0.06, h - 0.3), mat('walnut'), bevel=0.008, matrix=M)
    b.box((w - 0.2, 0.01, 0.025), (0, d / 2 - 0.04, h - 0.1), mat('metal_light'), matrix=M)
    b.box((0.42, 0.14, 0.018), (0.1, -0.16, h + 0.009), mat('plastic_dark'), bevel=0.004, matrix=M)
    b.box((0.3, 0.22, 0.02), (-0.55, -0.05, h + 0.01), mat('leather_dark'), bevel=0.004, matrix=M)
    b.box((0.08, 0.08, 0.1), (-0.72, 0.2, h + 0.05), mat('metal_dark'), bevel=0.01, matrix=M)


def bench_desk(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, 0.035), (0, 0, h - 0.0175), mat('oak_light'), bevel=0.01, matrix=M)
    for sx in (-1, 0, 1):
        b.box((0.05, d - 0.08, h - 0.035), (sx * (w / 2 - 0.08), 0.0, (h - 0.035) / 2), mat('metal_dark'), bevel=0.005, matrix=M)
    b.box((w - 0.2, 0.02, 0.3), (0, d / 2 - 0.05, h - 0.2), mat('desk_grey'), matrix=M)
    for k, x in enumerate((-0.8, 0.0, 0.8)):
        b.box((0.38, 0.13, 0.018), (x, -0.16, h + 0.009), mat('plastic_dark'), bevel=0.004, matrix=M)


def reception_counter(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    # Front counter: walnut lower panel, white marble upper band and top (like the reference);
    # receptionist desk behind at 0.75 m.
    fy = -d / 2 + 0.18
    b.box((w, 0.32, 0.1), (0, fy, 0.05), mat('slab'), bevel=0.008, matrix=M)
    b.box((w, 0.32, 0.5), (0, fy, 0.1 + 0.25), mat('walnut'), bevel=0.012, matrix=M)
    b.box((w, 0.33, h - 0.62), (0, fy, 0.6 + (h - 0.62) / 2), mat('marble'), bevel=0.015, matrix=M)
    b.box((w + 0.08, 0.44, 0.05), (0, fy - 0.01, h - 0.025), mat('marble'), bevel=0.014, matrix=M)
    b.box((w - 0.1, d - 0.32, 0.04), (0, 0.13, 0.73), mat('desk_white'), bevel=0.01, matrix=M)
    for sx in (-1, 1):
        b.box((0.05, d - 0.34, 0.71), (sx * (w / 2 - 0.08), 0.15, 0.355), mat('walnut'), bevel=0.008, matrix=M)
    # Glowing base edge (front and sides), double strip so it reads at the default zoom.
    e = ctx.emissive
    e.box((w + 0.02, 0.035, 0.035), (0, -d / 2 + 0.01, 0.115), mat('emissive_reception'), matrix=M)
    e.box((w - 0.06, 0.012, 0.012), (0, -d / 2 + 0.016, 0.6), mat('emissive_reception'), matrix=M)
    for sx in (-1, 1):
        e.box((0.035, 0.32, 0.035), (sx * (w / 2 + 0.01), fy, 0.115), mat('emissive_reception'), matrix=M)
    # Logo plate: dark hexagon with a light mark on the marble band.
    b.cyl(0.15, 0.014, (0, -d / 2 + 0.012, 0.82), mat('hub_dark'), segments=6, rot=(PI / 2, 0, 0), matrix=M)
    b.cyl(0.08, 0.014, (0, -d / 2 + 0.002, 0.82), mat('marble'), segments=6, rot=(PI / 2, 0, PI / 6), matrix=M)
    b.box((0.36, 0.26, 0.015), (0.55, 0.05, 0.76), mat('paper'), matrix=M)
    b.box((0.4, 0.13, 0.018), (0.1, 0.16, 0.76), mat('plastic_dark'), bevel=0.004, matrix=M)


# ---------------------------------------------------------------- seating (instanced)

def chair_office_mesh(b):
    seat_h = 0.47
    b.box((0.5, 0.48, 0.08), (0, -0.02, seat_h - 0.04), mat('fabric_dark'), bevel=0.03, segments=3)
    b.box((0.46, 0.07, 0.56), (0, 0.24, seat_h + 0.33), mat('fabric_dark'), bevel=0.03, segments=3, rot=(-0.12, 0, 0))
    b.box((0.08, 0.05, 0.3), (0, 0.24, seat_h + 0.04), mat('metal_dark'), bevel=0.01)
    for sx in (-1, 1):
        b.box((0.05, 0.26, 0.03), (sx * 0.27, -0.02, seat_h + 0.2), mat('plastic_dark'), bevel=0.012)
        b.box((0.03, 0.03, 0.18), (sx * 0.27, 0.05, seat_h + 0.1), mat('plastic_dark'))
    b.cyl(0.03, 0.32, (0, 0, seat_h - 0.24), mat('metal_dark'), segments=10)
    for k in range(5):
        a = k * 2 * PI / 5
        b.box((0.3, 0.04, 0.03), (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.07), mat('metal_dark'), bevel=0.008, rot=(0, 0, a))
        b.sphere(0.03, (math.cos(a) * 0.29, math.sin(a) * 0.29, 0.03), mat('plastic_dark'), subdiv=1)


def chair_exec_mesh(b):
    seat_h = 0.48
    b.box((0.56, 0.52, 0.1), (0, -0.02, seat_h - 0.05), mat('leather_dark'), bevel=0.04, segments=3)
    b.box((0.54, 0.1, 0.8), (0, 0.27, seat_h + 0.44), mat('leather_dark'), bevel=0.045, segments=3, rot=(-0.1, 0, 0))
    for sx in (-1, 1):
        b.box((0.07, 0.36, 0.06), (sx * 0.3, 0.02, seat_h + 0.2), mat('leather_dark'), bevel=0.02)
    b.cyl(0.035, 0.34, (0, 0, seat_h - 0.25), mat('metal_light'), segments=10)
    for k in range(5):
        a = k * 2 * PI / 5
        b.box((0.32, 0.045, 0.03), (math.cos(a) * 0.16, math.sin(a) * 0.16, 0.07), mat('metal_light'), bevel=0.008, rot=(0, 0, a))
        b.sphere(0.03, (math.cos(a) * 0.31, math.sin(a) * 0.31, 0.03), mat('plastic_dark'), subdiv=1)


def chair_visitor_mesh(b):
    b.box((0.46, 0.44, 0.07), (0, 0, 0.45), mat('fabric_grey'), bevel=0.025, segments=3)
    b.box((0.44, 0.06, 0.38), (0, 0.21, 0.72), mat('fabric_grey'), bevel=0.025, segments=3, rot=(-0.1, 0, 0))
    legs4(b, Matrix.Identity(4), 0.42, 0.4, 0.42, 0.015, mat('metal_dark'), inset=0.03)


# ---------------------------------------------------------------- monitors (instanced frame + unique screen)

def monitor_mesh(b, small=False):
    w = 0.5 if small else 0.58
    hgt = 0.3 if small else 0.34
    z0 = 0.13
    b.box((w + 0.03, 0.03, hgt + 0.03), (0, 0, z0 + hgt / 2), mat('plastic_dark'), bevel=0.008)
    b.box((0.05, 0.04, z0), (0, 0.04, z0 / 2), mat('plastic_dark'), bevel=0.006)
    b.box((0.22, 0.16, 0.012), (0, 0.03, 0.006), mat('plastic_dark'), bevel=0.004)
    return w, hgt, z0


def screen_size(variant):
    return (0.5, 0.3) if variant == 'small' else (0.58, 0.34)


# ---------------------------------------------------------------- lounge

def sofa_green(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, 0.28), (0, 0, 0.2), mat('sofa_green'), bevel=0.04, segments=3, matrix=M)
    seats = 3
    sw = (w - 0.3) / seats
    for k in range(seats):
        x = -w / 2 + 0.15 + sw * (k + 0.5)
        b.box((sw - 0.02, d - 0.3, 0.14), (x, -0.08, 0.4), mat('sofa_green_light'), bevel=0.05, segments=3, matrix=M)
        b.box((sw - 0.04, 0.2, 0.42), (x, d / 2 - 0.2, 0.63), mat('sofa_green_light'), bevel=0.06, segments=3, rot=(-0.12, 0, 0), matrix=M)
    b.box((w, 0.18, 0.74), (0, d / 2 - 0.09, 0.46), mat('sofa_green'), bevel=0.05, segments=3, matrix=M)
    for sx in (-1, 1):
        b.box((0.16, d, 0.62), (sx * (w / 2 - 0.08), 0, 0.37), mat('sofa_green'), bevel=0.05, segments=3, matrix=M)
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl(0.025, 0.06, (sx * (w / 2 - 0.1), sy * (d / 2 - 0.1), 0.03), mat('oak_light'), segments=8, matrix=M)
    # Two cushions.
    b.box((0.36, 0.14, 0.32), (-w / 2 + 0.42, d / 2 - 0.3, 0.63), mat('art_sand'), bevel=0.06, segments=3, matrix=M)
    b.box((0.34, 0.14, 0.3), (w / 2 - 0.42, d / 2 - 0.3, 0.62), mat('wall_paint'), bevel=0.06, segments=3, matrix=M)


def armchair_green(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, 0.28), (0, 0, 0.2), mat('sofa_green'), bevel=0.04, segments=3, matrix=M)
    b.box((w - 0.3, d - 0.28, 0.14), (0, -0.07, 0.4), mat('sofa_green_light'), bevel=0.05, segments=3, matrix=M)
    b.box((w, 0.18, 0.74), (0, d / 2 - 0.09, 0.46), mat('sofa_green'), bevel=0.05, segments=3, matrix=M)
    for sx in (-1, 1):
        b.box((0.15, d, 0.6), (sx * (w / 2 - 0.075), 0, 0.36), mat('sofa_green'), bevel=0.05, segments=3, matrix=M)


def coffee_table(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, 0.05), (0, 0, h - 0.025), mat('oak_light'), bevel=0.012, matrix=M)
    b.box((w - 0.1, d - 0.1, 0.03), (0, 0, 0.14), mat('oak_light'), bevel=0.006, matrix=M)
    legs4(b, M, w, d, h - 0.05, 0.022, mat('metal_dark'), inset=0.06)
    b.box((0.3, 0.22, 0.02), (-0.2, 0.05, h + 0.01), mat('book_blue'), matrix=M)
    b.cyl(0.04, 0.09, (0.25, -0.08, h + 0.045), mat('plastic_white'), segments=12, matrix=M)


def rug(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    faces = b.box((w, d, 0.012), (0, 0, 0.006), mat('rug_grey'), bevel=0.004, matrix=M, uvfix=1)
    _uv_planar_local(b, faces, M, w, d)


def _uv_planar_local(b, faces, M, w, d):
    uv = b.bm.loops.layers.uv.get('UVMap') or b.bm.loops.layers.uv.new('UVMap')
    inv = M.inverted()
    for f in faces:
        for loop in f.loops:
            lp = inv @ loop.vert.co
            loop[uv].uv = (lp.x / w + 0.5, lp.y / d + 0.5)


# ---------------------------------------------------------------- storage

def _books(b, M, x0, x1, y, z, depth, rng, height=0.26):
    x = x0
    mats = ['book_red', 'book_blue', 'book_cream', 'book_green', 'book_brown', 'book_navy', 'book_mustard']
    while x < x1 - 0.03:
        t = rng.uniform(0.025, 0.05)
        if rng.random() < 0.12:
            x += rng.uniform(0.05, 0.14)
            continue
        hh = height * rng.uniform(0.72, 1.0)
        lean = 0.0 if rng.random() < 0.85 else rng.uniform(-0.25, 0.25)
        b.box((t, depth * rng.uniform(0.75, 0.95), hh), (x + t / 2, y, z + hh / 2), mat(rng.choice(mats)), rot=(0, lean, 0), matrix=M)
        x += t + 0.004


def bookshelf(p, M, ctx, frame='walnut'):
    b = ctx.static
    w, h, d = p['size']
    rng = random.Random(int(p['pos'][0] * 100 + p['pos'][1] * 7))
    t = 0.035
    for sx in (-1, 1):
        b.box((t, d, h), (sx * (w / 2 - t / 2), 0, h / 2), mat(frame), bevel=0.006, matrix=M)
    b.box((w, d, t), (0, 0, h - t / 2), mat(frame), bevel=0.006, matrix=M)
    b.box((w - 2 * t, 0.015, h - 0.05), (0, d / 2 - 0.008, h / 2), mat(frame), matrix=M)
    shelves = 5
    for k in range(shelves):
        z = 0.05 + k * (h - 0.1) / shelves
        b.box((w - 2 * t, d - 0.02, 0.025), (0, 0, z), mat(frame), matrix=M)
        if k < shelves:
            _books(b, M, -w / 2 + t, w / 2 - t, 0.02, z + 0.0125, d - 0.06, rng, height=min(0.3, (h - 0.1) / shelves - 0.04))


def bookshelf_walnut(p, M, ctx):
    bookshelf(p, M, ctx, 'walnut')


def bookshelf_white(p, M, ctx):
    bookshelf(p, M, ctx, 'desk_white')


def credenza_walnut(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, h - 0.08), (0, 0, 0.08 + (h - 0.08) / 2), mat('walnut'), bevel=0.012, matrix=M)
    for k in range(3):
        x = -w / 2 + w / 6 + k * w / 3
        b.box((w / 3 - 0.03, 0.01, h - 0.16), (x, -d / 2 - 0.004, 0.08 + (h - 0.08) / 2), mat('walnut'), bevel=0.003, matrix=M)
        b.box((0.012, 0.02, 0.16), (x + w / 6 - 0.06, -d / 2 - 0.012, 0.45), mat('metal_light'), matrix=M)
    legs4(b, M, w, d, 0.08, 0.02, mat('metal_dark'), inset=0.06)


def cabinet_low(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    body = 'oak_light' if p.get('variant') == 'oak' else 'desk_white'
    b.box((w, d, h - 0.06), (0, 0, 0.06 + (h - 0.06) / 2), mat(body), bevel=0.01, matrix=M)
    n = 2 if w < 1.25 else 3
    for k in range(n):
        x = -w / 2 + w / (2 * n) + k * w / n
        b.box((w / n - 0.025, 0.01, h - 0.14), (x, -d / 2 - 0.004, 0.06 + (h - 0.06) / 2), mat('desk_grey' if body == 'desk_white' else 'oak_light'), bevel=0.003, matrix=M)
        b.box((0.1, 0.02, 0.014), (x, -d / 2 - 0.012, h - 0.12), mat('metal_dark'), matrix=M)
    b.box((w - 0.04, d - 0.04, 0.06), (0, 0, 0.03), mat('metal_dark'), matrix=M)


def filing_cabinet(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, d, h), (0, 0, h / 2), mat('plastic_grey'), bevel=0.01, matrix=M)
    for k in range(3):
        z = 0.18 + k * 0.33
        b.box((w - 0.05, 0.01, 0.3), (0, -d / 2 - 0.004, z), mat('plastic_white'), bevel=0.003, matrix=M)
        b.box((0.12, 0.02, 0.016), (0, -d / 2 - 0.012, z + 0.1), mat('metal_dark'), matrix=M)


# ---------------------------------------------------------------- appliances

def printer(p, M, ctx, small=False):
    b = ctx.static
    s = 0.7 if small else 1.0
    b.box((0.52 * s, 0.44 * s, 0.26 * s), (0, 0, 0.13 * s), mat('plastic_white'), bevel=0.015, matrix=M)
    b.box((0.5 * s, 0.4 * s, 0.07 * s), (0, 0.01, 0.295 * s), mat('plastic_grey'), bevel=0.01, matrix=M)
    b.box((0.36 * s, 0.2 * s, 0.015), (0, -0.16 * s, 0.17 * s), mat('paper'), matrix=M)
    b.box((0.16 * s, 0.02, 0.05 * s), (0.15 * s, -0.22 * s, 0.22 * s), mat('plastic_dark'), bevel=0.004, matrix=M)
    if not small:
        b.box((0.44, 0.36, 0.02), (0, -0.02, 0.34), mat('plastic_dark'), bevel=0.004, matrix=M)


def printer_small(p, M, ctx):
    printer(p, M, ctx, small=True)


def water_cooler(p, M, ctx):
    b = ctx.static
    b.box((0.32, 0.32, 0.95), (0, 0, 0.475), mat('plastic_white'), bevel=0.02, matrix=M)
    b.box((0.2, 0.02, 0.12), (0, -0.165, 0.72), mat('plastic_grey'), bevel=0.006, matrix=M)
    for sx in (-1, 1):
        b.cyl(0.015, 0.04, (sx * 0.05, -0.18, 0.7), mat('book_red' if sx < 0 else 'book_blue'), segments=8, rot=(PI / 2, 0, 0), matrix=M)
    b.cyl(0.14, 0.36, (0, 0, 1.13), mat('water_blue'), segments=20, radius2=0.12, matrix=M)
    b.cyl(0.05, 0.05, (0, 0, 1.33), mat('water_blue'), segments=14, matrix=M)


def whiteboard(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w + 0.05, 0.03, h + 0.05), (0, 0, 0), mat('frame_alu'), bevel=0.008, matrix=M)
    b.box((w, 0.012, h), (0, -0.016, 0), mat('whiteboard'), matrix=M)
    b.box((w * 0.6, 0.08, 0.025), (0, -0.05, -h / 2 - 0.02), mat('frame_alu'), matrix=M)
    rng = random.Random(42)
    colors = ['sticky_yellow', 'sticky_pink', 'sticky_blue', 'sticky_green', 'sticky_orange', 'sticky_yellow']
    # Sticky notes in loose columns on the right two thirds, scribbles on the left.
    for col in range(5):
        for row in range(3):
            if rng.random() < 0.18:
                continue
            x = -w * 0.05 + col * 0.21 + rng.uniform(-0.02, 0.02)
            z = h / 2 - 0.2 - row * 0.27 + rng.uniform(-0.02, 0.02)
            b.box((0.15, 0.006, 0.15), (x, -0.025, z), mat(rng.choice(colors)), rot=(0, rng.uniform(-0.12, 0.12), 0), matrix=M)
    for k in range(5):
        b.box((rng.uniform(0.3, 0.55), 0.004, 0.012), (-w / 2 + 0.38, -0.024, h / 2 - 0.18 - k * 0.15), mat('ink_dark' if k % 2 else 'ink_blue'), matrix=M)
    b.box((0.36, 0.004, 0.22), (-w / 2 + 0.38, -0.024, -h / 2 + 0.22), mat('ink_dark'), matrix=M)
    b.box((0.34, 0.006, 0.2), (-w / 2 + 0.38, -0.026, -h / 2 + 0.22), mat('whiteboard'), matrix=M)


def acoustic_panel(p, M, ctx):
    w, h, d = p['size']
    ctx.static.box((w, d, h), (0, 0, 0), mat('acoustic_panel'), bevel=0.012, matrix=M)


def booth_partition(p, M, ctx):
    w, h, d = p['size']
    ctx.static.box((w, 0.05, 0.05), (0, 0, h - 0.025), mat('frame_alu'), bevel=0.005, matrix=M)
    ctx.static.box((w, 0.05, 0.08), (0, 0, 0.04), mat('frame_alu'), bevel=0.005, matrix=M)
    ctx.static.box((0.05, 0.05, h), (w / 2 - 0.025, 0, h / 2), mat('frame_alu'), bevel=0.005, matrix=M)
    ctx.glass.box((w - 0.05, 0.012, h - 0.12), (-0.025, 0, h / 2), mat('glass'), matrix=M)


def pod_divider(p, M, ctx):
    """Low fabric privacy screen between back-to-back pod desks (sits on the desk tops)."""
    w, h, d = p['size']
    b = ctx.static
    b.box((w, d, h), (0, 0, h / 2), mat('wall_teal'), bevel=0.01, matrix=M)
    b.box((w + 0.02, d + 0.012, 0.025), (0, 0, h + 0.0125), mat('frame_alu'), bevel=0.004, matrix=M)
    for sx in (-1, 1):
        b.box((0.025, d + 0.012, h), (sx * (w / 2 + 0.0125), 0, h / 2), mat('frame_alu'), matrix=M)


def art_frame(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    b.box((w, 0.035, h), (0, 0, 0), mat('art_frame_dark'), bevel=0.006, matrix=M)
    b.box((w - 0.07, 0.01, h - 0.07), (0, -0.02, 0), mat('art_canvas'), matrix=M)
    v = p.get('variant', 'abstract-warm')
    iw, ih = w - 0.15, h - 0.15
    if v == 'landscape':
        b.box((iw, 0.006, ih * 0.55), (0, -0.026, ih * 0.2), mat('art_sky'), matrix=M)
        b.box((iw, 0.006, ih * 0.3), (0, -0.027, -ih * 0.25), mat('art_hill'), matrix=M)
        b.box((iw * 0.6, 0.006, ih * 0.22), (iw * 0.18, -0.028, -ih * 0.12), mat('art_hill_light'), rot=(0, 0.12, 0), matrix=M)
        b.cyl(ih * 0.1, 0.006, (-iw * 0.25, -0.03, ih * 0.25), mat('art_sand'), segments=16, rot=(PI / 2, 0, 0), matrix=M)
    else:
        palette = ['art_terra', 'art_sand', 'art_sage', 'art_ink'] if v == 'abstract-warm' else ['book_blue', 'art_sky', 'book_navy', 'wall_paint']
        b.box((iw * 0.5, 0.006, ih * 0.55), (-iw * 0.22, -0.026, ih * 0.18), mat(palette[0]), matrix=M)
        b.box((iw * 0.42, 0.006, ih * 0.4), (iw * 0.26, -0.027, -ih * 0.22), mat(palette[1]), matrix=M)
        b.cyl(min(iw, ih) * 0.16, 0.006, (iw * 0.22, -0.028, ih * 0.22), mat(palette[2]), segments=20, rot=(PI / 2, 0, 0), matrix=M)
        b.box((iw * 0.9, 0.006, 0.018), (0, -0.029, -ih * 0.02), mat(palette[3]), matrix=M)


def floor_lamp(p, M, ctx):
    b = ctx.static
    b.cyl(0.16, 0.03, (0, 0, 0.015), mat('metal_dark'), segments=20, matrix=M)
    b.cyl(0.012, 1.42, (0, 0, 0.74), mat('metal_dark'), segments=8, matrix=M)
    b.cyl(0.22, 0.28, (0, 0, 1.52), mat('wall_trim'), segments=24, radius2=0.16, cap=False, matrix=M)
    ctx.emissive.cyl(0.15, 0.02, (0, 0, 1.39), mat('emissive_lamp'), segments=20, matrix=M)


def desk_lamp(p, M, ctx):
    b = ctx.static
    b.cyl(0.07, 0.02, (0, 0, 0.01), mat('metal_dark'), segments=16, matrix=M)
    b.cyl(0.008, 0.34, (0, 0.02, 0.18), mat('metal_dark'), segments=6, rot=(0.25, 0, 0), matrix=M)
    b.cyl(0.07, 0.1, (0, -0.06, 0.36), mat('metal_dark'), segments=16, radius2=0.03, cap=False, rot=(-0.6, 0, 0), matrix=M)
    ctx.emissive.cyl(0.05, 0.01, (0, -0.075, 0.33), mat('emissive_lamp'), segments=12, rot=(-0.6, 0, 0), matrix=M)


def sconce(p, M, ctx, outdoor=False):
    b = ctx.static
    b.box((0.12, 0.03, 0.2), (0, 0.0, 0), mat('metal_dark'), bevel=0.006, matrix=M)
    ctx.emissive.box((0.1, 0.07, 0.14), (0, -0.05, 0), mat('emissive_lamp'), matrix=M)
    b.box((0.13, 0.08, 0.02), (0, -0.045, 0.08), mat('metal_dark'), matrix=M)
    if not outdoor:
        b.box((0.13, 0.08, 0.02), (0, -0.045, -0.08), mat('metal_dark'), matrix=M)


def sconce_outdoor(p, M, ctx):
    sconce(p, M, ctx, outdoor=True)


def mat_prop(p, M, ctx):
    w, h, d = p['size']
    ctx.static.box((w, d, 0.015), (0, 0, 0.0075), mat('mat_dark'), bevel=0.004, matrix=M)


# ---------------------------------------------------------------- Lead Hub

def hub(p, M, ctx):
    b = ctx.static
    w, h, d = p['size']
    r = w / 2
    b.cyl(r + 0.08, 0.1, (0, 0, 0.05), mat('hub_dark'), segments=40, bevel=0.015, matrix=M)
    b.cyl(r, 0.08, (0, 0, 0.14), mat('hub_body'), segments=40, bevel=0.01, matrix=M)
    # Glass drum with glowing core and light bands.
    ctx.glass.cyl(r - 0.04, h - 0.42, (0, 0, 0.18 + (h - 0.42) / 2), mat('glass_hub'), segments=40, cap=False, matrix=M)
    ctx.emissive.cyl(r * 0.55, h - 0.46, (0, 0, 0.18 + (h - 0.46) / 2), mat('emissive_hub_soft'), segments=24, matrix=M)
    for k in range(3):
        z = 0.32 + k * 0.22
        ctx.emissive.cyl(r - 0.02, 0.022, (0, 0, z), mat('emissive_hub'), segments=40, cap=False, matrix=M)
    for k in range(8):
        a = k * PI / 4
        b.box((0.035, 0.035, h - 0.42), (math.cos(a) * (r - 0.03), math.sin(a) * (r - 0.03), 0.18 + (h - 0.42) / 2), mat('hub_body'), matrix=M)
    b.cyl(r + 0.03, 0.12, (0, 0, h - 0.18), mat('hub_body'), segments=40, bevel=0.03, matrix=M)
    b.cyl(r - 0.12, 0.05, (0, 0, h - 0.1), mat('hub_dark'), segments=40, bevel=0.01, matrix=M)
    ctx.emissive.torus(r - 0.14, 0.012, (0, 0, h - 0.075), mat('emissive_hub'), major_segments=48, minor_segments=6, matrix=M)
    # Front screen (runtime draws "LEAD HUB" on it): a curved panel on the -Y side.
    ctx.hub_screen = (M, r + 0.006, 0.34, 0.98, 0.44)


def hub_ring(p, M, ctx):
    w, h, d = p['size']
    r = w / 2
    ctx.static.cyl(r + 0.22, 0.03, (0, 0, 0.015), mat('hub_platform'), segments=72, bevel=0.01, matrix=M)
    ctx.static.cyl(0.98, 0.012, (0, 0, 0.036), mat('hub_platform_dark'), segments=48, matrix=M)
    ctx.emissive.torus(r, 0.04, (0, 0, 0.04), mat('emissive_hub'), major_segments=96, minor_segments=6, matrix=M)
    ctx.emissive.torus(r * 0.78, 0.014, (0, 0, 0.034), mat('emissive_hub_soft'), major_segments=72, minor_segments=4, matrix=M)


# ---------------------------------------------------------------- plants (instanced)

def _leaf(b, base, direction, length, width, matname, droop=0.35):
    """A bent, tapered leaf as three flattened icospheres along an arc."""
    d = direction.normalized()
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    pts = []
    for k in range(3):
        t = (k + 0.5) / 3
        p = base + d * (length * t) + Vector((0, 0, -droop * length * t * t))
        pts.append(p)
    for k, p in enumerate(pts):
        s = (1.0 - abs(k - 1) * 0.3)
        nxt = pts[min(2, k + 1)] - pts[max(0, k - 1)]
        rot = nxt.to_track_quat('Y', 'Z').to_matrix().to_4x4()
        b.sphere(1.0, (0, 0, 0), mat(matname), subdiv=1, matrix=Matrix.Translation(p) @ rot @ Matrix.Diagonal((width * s, length / 3 * 0.75, width * 0.18, 1.0)), smooth=False)


def plant_mesh(b, kind, variant):
    rng = random.Random(hash((kind, variant)) & 0xffffffff)
    if kind == 'plant_desk':
        b.cyl(0.05, 0.08, (0, 0, 0.04), mat('pot_white'), segments=12, radius2=0.045)
        b.cyl(0.044, 0.01, (0, 0, 0.08), mat('soil'), segments=12)
        if variant == 'snake':
            for k in range(5):
                a = k * 2 * PI / 5
                b.box((0.02, 0.006, 0.16), (math.cos(a) * 0.015, math.sin(a) * 0.015, 0.16), mat('leaf_b' if k % 2 else 'leaf_a'), rot=(rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), a))
        else:
            for k in range(6):
                a = k * 2 * PI / 6
                b.sphere(0.03, (math.cos(a) * 0.02, math.sin(a) * 0.02, 0.1), mat('leaf_c'), subdiv=1, scale=(1, 0.6, 1.3), rot=(0.5, 0, a), smooth=False)
        return
    if kind == 'desk_mug':
        return
    if kind == 'plant_floor_small':
        b.cyl(0.17, 0.26, (0, 0, 0.13), mat('pot_concrete'), segments=16, radius2=0.14, bevel=0.01)
        for k in range(9):
            a = rng.uniform(0, 2 * PI)
            rr = rng.uniform(0.02, 0.12)
            b.sphere(rng.uniform(0.09, 0.13), (math.cos(a) * rr, math.sin(a) * rr, 0.36 + rng.uniform(0, 0.12)), mat(rng.choice(['leaf_a', 'leaf_b', 'leaf_c'])), subdiv=1, smooth=False)
        return
    tall = kind == 'plant_tall'
    pot_h = 0.42 if tall else 0.32
    pot_r = 0.22 if tall else 0.17
    pot_mat = {'palm': 'pot_white', 'fiddle': 'pot_dark', 'monstera': 'pot_terracotta', 'bush': 'pot_white', 'round': 'pot_concrete'}.get(variant, 'pot_white')
    b.cyl(pot_r, pot_h, (0, 0, pot_h / 2), mat(pot_mat), segments=20, radius2=pot_r * 0.82, bevel=0.012)
    b.cyl(pot_r * 0.92, 0.02, (0, 0, pot_h - 0.02), mat('soil'), segments=20)
    top = pot_h
    if variant == 'palm':
        for k in range(10):
            a = k * 2 * PI / 10 + rng.uniform(-0.2, 0.2)
            hgt = rng.uniform(0.7, 1.25) if tall else rng.uniform(0.4, 0.7)
            stem_top = Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, top + hgt))
            b.cyl(0.008, hgt, (math.cos(a) * 0.06, math.sin(a) * 0.06, top + hgt / 2), mat('leaf_b'), segments=5, rot=(0, 0.1 * math.cos(a), 0))
            for s in (-1, 1):
                _leaf(b, stem_top, Vector((math.cos(a + s * 0.5), math.sin(a + s * 0.5), 0.4)), 0.42 if tall else 0.3, 0.06, 'leaf_a' if s > 0 else 'leaf_c', droop=0.5)
            _leaf(b, stem_top, Vector((math.cos(a), math.sin(a), 0.9)), 0.36 if tall else 0.26, 0.07, 'leaf_a', droop=0.25)
    elif variant == 'fiddle':
        trunk = 1.1 if tall else 0.6
        b.cyl(0.018, trunk, (0, 0, top + trunk / 2), mat('book_brown'), segments=6)
        for k in range(16 if tall else 10):
            z = top + 0.25 + (trunk + 0.2) * (k / (16 if tall else 10))
            a = k * 2.4
            _leaf(b, Vector((0, 0, z)), Vector((math.cos(a), math.sin(a), 0.5)), 0.26, 0.11, rng.choice(['leaf_a', 'leaf_b']), droop=0.15)
    elif variant == 'monstera':
        for k in range(9 if tall else 7):
            a = k * 2 * PI / (9 if tall else 7) + rng.uniform(-0.3, 0.3)
            hgt = (rng.uniform(0.5, 0.95) if tall else rng.uniform(0.3, 0.55))
            tip = Vector((math.cos(a) * 0.18, math.sin(a) * 0.18, top + hgt))
            b.cyl(0.009, hgt, (math.cos(a) * 0.09, math.sin(a) * 0.09, top + hgt / 2), mat('leaf_b'), segments=5)
            _leaf(b, tip, Vector((math.cos(a), math.sin(a), 0.15)), 0.36 if tall else 0.3, 0.18, rng.choice(['leaf_a', 'leaf_b', 'leaf_c']), droop=0.3)
    else:  # bush
        for k in range(14):
            a = rng.uniform(0, 2 * PI)
            rr = rng.uniform(0.0, 0.17)
            b.sphere(rng.uniform(0.11, 0.16), (math.cos(a) * rr, math.sin(a) * rr, top + 0.12 + rng.uniform(0, 0.38)), mat(rng.choice(['leaf_a', 'leaf_b', 'leaf_c'])), subdiv=1, smooth=False)


def mug_mesh(b):
    b.cyl(0.04, 0.09, (0, 0, 0.045), mat('plastic_white'), segments=14)
    b.torus(0.025, 0.007, (0.045, 0, 0.05), mat('plastic_white'), major_segments=10, minor_segments=4, matrix=Matrix.Translation((0.045, 0, 0.05)) @ Matrix.Rotation(PI / 2, 4, 'X') @ Matrix.Translation((-0.045, 0, -0.05)))
    b.cyl(0.035, 0.005, (0, 0, 0.085), mat('book_brown'), segments=14)


STATIC_BUILDERS = {
    'desk_white': desk_white,
    'desk_booth': desk_booth,
    'desk_walnut': desk_walnut,
    'bench_desk': bench_desk,
    'reception_counter': reception_counter,
    'sofa_green': sofa_green,
    'armchair_green': armchair_green,
    'coffee_table': coffee_table,
    'rug': rug,
    'bookshelf_walnut': bookshelf_walnut,
    'bookshelf_white': bookshelf_white,
    'credenza_walnut': credenza_walnut,
    'cabinet_low': cabinet_low,
    'filing_cabinet': filing_cabinet,
    'printer': printer,
    'printer_small': printer_small,
    'water_cooler': water_cooler,
    'whiteboard': whiteboard,
    'acoustic_panel': acoustic_panel,
    'booth_partition': booth_partition,
    'pod_divider': pod_divider,
    'art_frame': art_frame,
    'floor_lamp': floor_lamp,
    'desk_lamp': desk_lamp,
    'sconce': sconce,
    'sconce_outdoor': sconce_outdoor,
    'mat': mat_prop,
    'hub': hub,
    'hub_ring': hub_ring,
}


def instanced_mesh_key(p):
    t = p['type']
    v = p.get('variant', '')
    if t == 'monitor':
        return f'monitor_{"small" if v == "small" else "std"}'
    if t.startswith('plant'):
        return f'{t}_{v or "default"}'
    return t


def build_instanced_mesh(key, b):
    if key.startswith('monitor_'):
        monitor_mesh(b, small=key.endswith('small'))
    elif key == 'chair_office':
        chair_office_mesh(b)
    elif key == 'chair_exec':
        chair_exec_mesh(b)
    elif key == 'chair_visitor':
        chair_visitor_mesh(b)
    elif key == 'desk_mug':
        mug_mesh(b)
    else:
        kind, _, variant = key.rpartition('_')
        plant_mesh(b, kind, variant)
