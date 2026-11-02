import * as THREE from 'three';
import type { FloorLayout } from '../state/layout';
import { ART } from './look';

/**
 * Procedural fallback office built from the floor template (used only when the authored GLB cannot
 * load, so the floor is never blank): room floors, walls, furniture blocks from the walk
 * obstacles, and the Lead Hub ring. Lit in realtime with the same key/fill lights as the people.
 */

export interface Environment {
  group: THREE.Group;
  dispose(): void;
}

const FLOOR_COLOR: Record<string, string> = { oak: ART.oak, walnut: ART.walnut, carpet: ART.carpet, stone: '#c9c6c0' };

export function buildFallbackEnvironment(layout: FloorLayout): Environment {
  const group = new THREE.Group();
  group.name = 'environment-fallback';
  const owned: { dispose(): void }[] = [];
  const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, ...extra });
    owned.push(m);
    return m;
  };
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, ry = 0) => {
    owned.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Slab under the footprint.
  const footprint = new THREE.Shape(layout.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
  const slab = new THREE.ExtrudeGeometry(footprint, { depth: 0.3, bevelEnabled: false });
  slab.rotateX(-Math.PI / 2);
  add(slab, mat(ART.slate), 0, -0.3, 0);

  for (const room of layout.rooms) {
    const shape = new THREE.Shape(room.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    add(geo, mat(FLOOR_COLOR[room.floor] ?? ART.oak), 0, 0.002, 0);
  }

  const glass = mat(ART.glass, { transparent: true, opacity: 0.2, depthWrite: false });
  for (const w of layout.template.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / len;
    const uz = (w.b[1] - w.a[1]) / len;
    const ry = -Math.atan2(uz, ux);
    let cursor = 0;
    const cuts = [...w.openings].filter((o) => o.kind !== 'window').sort((p, q) => p.from - q.from);
    for (const o of [...cuts, { from: len, to: len }]) {
      if (o.from > cursor) {
        const seg = o.from - cursor;
        const cx = w.a[0] + ux * (cursor + seg / 2);
        const cz = w.a[1] + uz * (cursor + seg / 2);
        const m = w.kind === 'glass' || w.kind === 'glass_walnut' ? glass : mat(w.kind === 'front' ? ART.slate : ART.paint);
        add(new THREE.BoxGeometry(seg, w.height, w.thickness), m, cx, w.height / 2, cz, ry);
      }
      cursor = Math.max(cursor, o.to);
    }
  }

  const furniture = mat(ART.desk);
  for (const o of layout.obstacles) {
    if (o.kind === 'circle') {
      add(new THREE.CylinderGeometry(o.hw * 0.8, o.hw * 0.7, 0.9, 12), mat(ART.leaf), o.x, 0.45, o.z);
    } else {
      add(new THREE.BoxGeometry(o.hw * 2, 0.75, o.hd * 2), furniture, o.x, 0.375, o.z, Math.atan2(o.sin, o.cos));
    }
  }

  const ring = new THREE.TorusGeometry(layout.template.hub.ringRadius, 0.04, 6, 64);
  ring.rotateX(-Math.PI / 2);
  add(ring, new THREE.MeshBasicMaterial({ color: '#3b82f6', toneMapped: false }), layout.hub.x, 0.04, layout.hub.z);
  add(new THREE.CylinderGeometry(0.6, 0.66, 1.2, 24), mat(ART.hub), layout.hub.x, 0.6, layout.hub.z);

  return {
    group,
    dispose() {
      for (const o of owned) o.dispose();
    },
  };
}
