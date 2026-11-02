"""Shared helpers for the Vistar Team Floor Blender scripts (Blender 5.2, run with --background).

Coordinates: the floor templates use metres with x = east, z = south, y = up (three.js). Blender is
Z-up, so a template point (x, z) at height y maps to Blender (x, -z, y). glTF export converts back.
A template heading `facing` (degrees, 0 = +z, 90 = +x) maps to a Blender rotation about Z of
radians(facing) for meshes modelled with their front towards Blender -Y.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_TMP = os.path.join(REPO, 'scripts', 'team-floor', '.out')
PUBLIC = os.path.join(REPO, 'apps', 'web', 'public', 'team-floor')


def cli_args():
    """Arguments after `--` as a dict: --key value, --flag."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    out = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith('--'):
            key = a[2:]
            if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
                out[key] = argv[i + 1]
                i += 2
                continue
            out[key] = True
        i += 1
    return out


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    return scene


def load_template(template_id):
    path = os.path.join(PUBLIC, 'templates', f'{template_id}.json')
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def t2b(x, z, y=0.0):
    return Vector((x, -z, y))


def rz(facing_deg):
    return math.radians(facing_deg)


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


# ---------------------------------------------------------------- materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4))


_principled_cache = {}


def material(name, color='#cccccc', roughness=0.8, metallic=0.0, alpha=1.0, emission=None, emission_strength=0.0, image=None):
    """Principled material (exports to glTF PBR). `image` = path of a base colour texture."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*hex_rgb(color), 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.25
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        try:
            mat.surface_render_method = 'BLENDED'
        except Exception:
            pass
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*hex_rgb(emission), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    if image:
        img = bpy.data.images.load(image, check_existing=True)
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        tex.interpolation = 'Linear'
        uv = nt.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        nt.links.new(uv.outputs['UV'], tex.inputs['Vector'])
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        tex.location = (-400, 200)
        uv.location = (-650, 200)
    mat.diffuse_color = (*hex_rgb(color), alpha)
    return mat


# ---------------------------------------------------------------- mesh building

class MeshBuilder:
    """Accumulates bevelled primitives in one bmesh with per-face material indices."""

    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []
        self.uvfix = self.bm.faces.layers.int.new('uvfix')

    def mi(self, mat):
        name = mat if isinstance(mat, str) else mat.name
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def _finish(self, before, mat, bevel, segments, uvfix=0):
        new_faces = [f for f in self.bm.faces if f not in before]
        if bevel > 0:
            edges = list({e for f in new_faces for e in f.edges})
            res = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
            new_faces = [f for f in self.bm.faces if f not in before]
        idx = self.mi(mat)
        for f in new_faces:
            f.material_index = idx
            f[self.uvfix] = uvfix
            f.smooth = bevel > 0
        return new_faces

    def box(self, size, center, mat, bevel=0.0, segments=2, rot=(0.0, 0.0, 0.0), matrix=None, uvfix=0):
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(center)) @ _euler(rot) @ Matrix.Diagonal((*size, 1.0))
        if matrix is not None:
            m = matrix @ m
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        return self._finish(before, mat, bevel, segments, uvfix)

    def cyl(self, radius, depth, center, mat, segments=16, radius2=None, bevel=0.0, bevel_segments=2, rot=(0.0, 0.0, 0.0), matrix=None, cap=True):
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(center)) @ _euler(rot)
        if matrix is not None:
            m = matrix @ m
        bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=segments, radius1=radius, radius2=radius if radius2 is None else radius2, depth=depth, matrix=m)
        faces = [f for f in self.bm.faces if f not in before]
        if bevel > 0:
            cap_edges = [e for f in faces if len(f.verts) > 4 for e in f.edges]
            bmesh.ops.bevel(self.bm, geom=list(set(cap_edges)), offset=bevel, offset_type='OFFSET', segments=bevel_segments, profile=0.5, affect='EDGES', clamp_overlap=True)
        faces = [f for f in self.bm.faces if f not in before]
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = True
        # Caps stay flat shaded so they read as hard edges.
        for f in faces:
            if len(f.verts) > 4:
                f.smooth = False
        return faces

    def sphere(self, radius, center, mat, subdiv=2, scale=(1.0, 1.0, 1.0), rot=(0.0, 0.0, 0.0), matrix=None, smooth=True):
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(center)) @ _euler(rot) @ Matrix.Diagonal((*scale, 1.0))
        if matrix is not None:
            m = matrix @ m
        bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=radius, matrix=m)
        faces = [f for f in self.bm.faces if f not in before]
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    def uvsphere(self, radius, center, mat, u=12, v=8, scale=(1.0, 1.0, 1.0), rot=(0.0, 0.0, 0.0), matrix=None):
        before = set(self.bm.faces)
        m = Matrix.Translation(Vector(center)) @ _euler(rot) @ Matrix.Diagonal((*scale, 1.0))
        if matrix is not None:
            m = matrix @ m
        bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=radius, matrix=m)
        faces = [f for f in self.bm.faces if f not in before]
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = True
        return faces

    def polygon(self, points, z, mat, flip=False):
        """Flat n-gon from (x, y) Blender points at height z (normal +Z unless flipped)."""
        verts = [self.bm.verts.new((p[0], p[1], z)) for p in points]
        if flip:
            verts.reverse()
        face = self.bm.faces.new(verts)
        face.normal_update()
        if face.normal.z < 0 and not flip:
            face.normal_flip()
        face.material_index = self.mi(mat)
        return [face]

    def torus(self, major, minor, center, mat, major_segments=64, minor_segments=8, matrix=None):
        before = set(self.bm.faces)
        verts = []
        for i in range(major_segments):
            a = 2 * math.pi * i / major_segments
            ring = []
            for j in range(minor_segments):
                b = 2 * math.pi * j / minor_segments
                r = major + minor * math.cos(b)
                ring.append(self.bm.verts.new((center[0] + r * math.cos(a), center[1] + r * math.sin(a), center[2] + minor * math.sin(b))))
            verts.append(ring)
        for i in range(major_segments):
            for j in range(minor_segments):
                a = verts[i][j]
                b = verts[(i + 1) % major_segments][j]
                c = verts[(i + 1) % major_segments][(j + 1) % minor_segments]
                d = verts[i][(j + 1) % minor_segments]
                self.bm.faces.new((a, b, c, d))
        faces = [f for f in self.bm.faces if f not in before]
        if matrix is not None:
            bmesh.ops.transform(self.bm, matrix=matrix, verts=list({v for f in faces for v in f.verts}))
        idx = self.mi(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = True
        return faces

    def transform_faces(self, faces, matrix):
        bmesh.ops.transform(self.bm, matrix=matrix, verts=list({v for f in faces for v in f.verts}))

    def to_mesh(self, name):
        bm = self.bm
        bm.normal_update()
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        for n in self.mats:
            me.materials.append(bpy.data.materials[n])
        return me

    def free(self):
        self.bm.free()


def _euler(rot):
    return (Matrix.Rotation(rot[2], 4, 'Z') @ Matrix.Rotation(rot[1], 4, 'Y') @ Matrix.Rotation(rot[0], 4, 'X'))


def place_matrix(x, z, y=0.0, facing=0.0):
    """World matrix for a prop at template (x, z), height y, heading facing (deg)."""
    return Matrix.Translation(t2b(x, z, y)) @ Matrix.Rotation(rz(facing), 4, 'Z')


def link_object(name, mesh, col, matrix=None):
    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    if matrix is not None:
        obj.matrix_world = matrix
    return obj


# ---------------------------------------------------------------- UV helpers

def box_project_uv(mesh, layer_name, tiles, default_tile=1.0, matrix=None):
    """World-space box projection into `layer_name` for faces whose `uvfix` is 0.
    `tiles` maps material name -> (tile size in metres, mode) where mode 'planks_x' runs the
    texture u along world X on floors and vertically on walls."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.get(layer_name) or bm.loops.layers.uv.new(layer_name)
    fix = bm.faces.layers.int.get('uvfix')
    mw = matrix or Matrix.Identity(4)
    names = [m.name if m else '' for m in mesh.materials]
    for f in bm.faces:
        if fix is not None and f[fix] == 1:
            continue
        name = names[f.material_index] if f.material_index < len(names) else ''
        tile, mode = tiles.get(name, (default_tile, 'box'))
        n = (mw.to_3x3() @ f.normal).normalized()
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            p = mw @ loop.vert.co
            if ax == 2:
                u, v = p.x, p.y
            elif ax == 0:
                u, v = (p.z, p.y) if mode == 'vertical' else (p.y, p.z)
            else:
                u, v = (p.z, p.x) if mode == 'vertical' else (p.x, p.z)
            loop[uv].uv = (u / tile, v / tile)
    bm.to_mesh(mesh)
    bm.free()


def ensure_uv(mesh, name):
    if name not in mesh.uv_layers:
        mesh.uv_layers.new(name=name)
    return mesh.uv_layers[name]


# ---------------------------------------------------------------- images

def save_rgb_image(name, pixels_rgba, width, height, path, fmt='PNG', quality=90):
    """Save a numpy float array (h, w, 4) already in display (sRGB) encoding, values 0..1."""
    import numpy as np
    img = bpy.data.images.get(name)
    if img is not None:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, width=width, height=height, alpha=True, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(np.ascontiguousarray(pixels_rgba, dtype=np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        img.save(filepath=path, quality=quality)
    except TypeError:
        img.save()
    return img


def linear_to_srgb_np(x):
    import numpy as np
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------- camera / render previews

def iso_camera(template, name='IsoCam', resolution=(1600, 1000)):
    cam = template['camera']
    (x0, z0), (x1, z1) = template['bounds']['min'], template['bounds']['max']
    center = t2b((x0 + x1) / 2, (z0 + z1) / 2, 0.6)
    yaw = math.radians(cam['yawDeg'])
    pitch = math.radians(cam['pitchDeg'])
    # View direction from the scene towards the camera (template +x +z, up).
    d = Vector((math.cos(pitch) * math.sin(yaw), -math.cos(pitch) * math.cos(yaw), math.sin(pitch)))
    data = bpy.data.cameras.new(name)
    data.type = 'ORTHO'
    span = math.hypot(x1 - x0, z1 - z0)
    data.ortho_scale = span * 1.02
    data.clip_end = 400
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = center + d * 80
    obj.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene = bpy.context.scene
    scene.camera = obj
    scene.render.resolution_x, scene.render.resolution_y = resolution
    return obj


def set_standard_view(scene):
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
