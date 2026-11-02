import * as THREE from 'three';
import type { FloorTemplate } from '../state/template';

/**
 * Restrained bloom for the Evening look (SPEC 12.1 item 2), limited to emissive sources: soft
 * additive glow cards around lamps and sconces, monitor screens, the Lead Hub ring and the
 * reception edge. Cards are placed from the floor template (the same data the Blender build used),
 * so no post-processing pass and no extra scene render are needed. Three draw calls in total
 * (lamp billboards, screen halos, floor glows). Off in Day and on the low quality tier.
 */

const LAMP_GLOW: Record<string, { size: number; up: number; front: number; color: string }> = {
  sconce: { size: 0.75, up: 0, front: 0.08, color: '#ffc27a' },
  sconce_outdoor: { size: 0.6, up: 0, front: 0.08, color: '#ffc27a' },
  floor_lamp: { size: 1.1, up: 1.4, front: 0, color: '#ffcf8f' },
  desk_lamp: { size: 0.5, up: 0.3, front: 0.06, color: '#ffd59c' },
};

const SCREEN_COLOR = new THREE.Color('#6f9bff');
const HUB_COLOR = new THREE.Color('#3b82f6');
const RECEPTION_COLOR = new THREE.Color('#4d6dff');

export class GlowLayer {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly lampMat: THREE.MeshBasicMaterial;
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly floorMat: THREE.MeshBasicMaterial;
  private readonly screens: THREE.InstancedMesh | null;
  private readonly screenIndex = new Map<string, number>();
  private readonly screenLevels: number[] = [];
  private level = 0;
  private enabled = true;
  private readonly tmpColor = new THREE.Color();

  constructor(template: FloorTemplate, screenNodes: Map<string, THREE.Mesh>) {
    this.group.name = 'glow';
    const soft = glowTexture('round');
    const rect = glowTexture('rect');
    const ring = glowTexture('ring');
    this.owned.push(soft, rect, ring);
    const additive = (map: THREE.Texture) => {
      const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
      this.owned.push(m);
      return m;
    };
    this.lampMat = additive(soft);
    this.screenMat = additive(rect);
    this.floorMat = additive(ring);

    // Lamps: camera-facing quads (the camera never rotates), pushed towards the viewer so the wall
    // they hang on does not cut them.
    const yaw = (template.camera.yawDeg * Math.PI) / 180;
    const pitch = (template.camera.pitchDeg * Math.PI) / 180;
    const toCam = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    const facing = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toCam);
    const lamps = template.props.filter((p) => LAMP_GLOW[p.type]);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.owned.push(quad);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    if (lamps.length) {
      const mesh = new THREE.InstancedMesh(quad, this.lampMat, lamps.length);
      lamps.forEach((p, i) => {
        const g = LAMP_GLOW[p.type]!;
        const f = (p.facing * Math.PI) / 180;
        pos.set(p.pos[0] + Math.sin(f) * g.front, (p.y ?? 0) + g.up, p.pos[1] + Math.cos(f) * g.front).addScaledVector(toCam, 0.35);
        m.compose(pos, facing, scale.setScalar(g.size));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, this.tmpColor.set(g.color));
      });
      mesh.renderOrder = 5;
      mesh.name = 'glow:lamps';
      this.group.add(mesh);
    }

    // Screens: a halo quad 1.9x the screen, 1.5 cm in front of it, tinted per seat level.
    const screens = [...screenNodes.entries()];
    this.screens = screens.length ? new THREE.InstancedMesh(quad, this.screenMat, screens.length) : null;
    if (this.screens) {
      const box = new THREE.Box3();
      const normal = new THREE.Vector3();
      const q = new THREE.Quaternion();
      screens.forEach(([id, node], i) => {
        node.updateWorldMatrix(true, false);
        node.geometry.computeBoundingBox();
        box.copy(node.geometry.boundingBox!).applyMatrix4(node.matrixWorld);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        // Screen normal: the quad's own normal in world space.
        const n = node.geometry.getAttribute('normal');
        normal.set(n ? n.getX(0) : 0, n ? n.getY(0) : 0, n ? n.getZ(0) : 1).transformDirection(node.matrixWorld);
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        const w = Math.max(size.x, size.z);
        m.compose(centre.addScaledVector(normal, 0.015), q, scale.set(w * 1.9, size.y * 2.3, 1));
        this.screens!.setMatrixAt(i, m);
        this.screens!.setColorAt(i, SCREEN_COLOR);
        this.screenIndex.set(id, i);
        this.screenLevels.push(1);
      });
      this.screens.renderOrder = 5;
      this.screens.name = 'glow:screens';
      this.group.add(this.screens);
    }

    // Floor glows: the Lead Hub ring and the reception base edge.
    const floor: { x: number; z: number; w: number; d: number; rot: number; color: THREE.Color; map: 'ring' | 'rect' }[] = [];
    const r = template.hub.ringRadius;
    floor.push({ x: template.hub.pos[0], z: template.hub.pos[1], w: r * 2.9, d: r * 2.9, rot: 0, color: HUB_COLOR, map: 'ring' });
    for (const p of template.props) {
      if (p.type !== 'reception_counter' || !p.size) continue;
      const [w, , d] = p.size;
      const f = (p.facing * Math.PI) / 180;
      // Base edge on the counter front (local -Y in Blender = template heading `facing`).
      floor.push({ x: p.pos[0] + Math.sin(f) * (d / 2 + 0.12), z: p.pos[1] + Math.cos(f) * (d / 2 + 0.12), w: w + 0.9, d: 0.9, rot: f, color: RECEPTION_COLOR, map: 'rect' });
    }
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.owned.push(flat);
    const ringMat = this.floorMat;
    const rectMat = additive(rect);
    for (const g of floor) {
      const mesh = new THREE.Mesh(flat, g.map === 'ring' ? ringMat : rectMat);
      mesh.position.set(g.x, 0.05, g.z);
      mesh.rotation.y = g.rot;
      mesh.scale.set(g.w, 1, g.d);
      mesh.renderOrder = 5;
      mesh.userData.color = g.color.clone();
      mesh.name = `glow:floor:${g.map}`;
      this.group.add(mesh);
    }
    this.rectFloor = rectMat;
    this.apply();
  }

  private readonly rectFloor: THREE.MeshBasicMaterial;

  /** 0 = off (Day), 1 = full Evening glow. */
  setLevel(level: number) {
    if (Math.abs(level - this.level) < 1e-3) return;
    this.level = level;
    this.apply();
  }

  /** Tier gate (off on the low tier). */
  setEnabled(on: boolean) {
    if (on === this.enabled) return;
    this.enabled = on;
    this.apply();
  }

  /** Per-seat screen level (1 working, 0.35 idle, ~0 off), same scale as Office.setScreen. */
  setScreen(seatId: string, level: number) {
    const i = this.screenIndex.get(seatId);
    if (i === undefined || !this.screens || this.screenLevels[i] === level) return;
    this.screenLevels[i] = level;
    this.screens.setColorAt(i, this.tmpColor.copy(SCREEN_COLOR).multiplyScalar(level));
    if (this.screens.instanceColor) this.screens.instanceColor.needsUpdate = true;
  }

  private apply() {
    const on = this.enabled && this.level > 0.01;
    this.group.visible = on;
    if (!on) return;
    const l = this.level;
    this.lampMat.opacity = 0.55 * l;
    this.screenMat.opacity = 0.32 * l;
    this.floorMat.color.copy(HUB_COLOR).multiplyScalar(0.5 * l);
    this.rectFloor.color.copy(RECEPTION_COLOR).multiplyScalar(0.55 * l);
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
  }
}

/** Soft additive glow textures: round (lamps), rounded rectangle (screens, strips), ring (hub). */
function glowTexture(kind: 'round' | 'rect' | 'ring'): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  if (kind === 'round') {
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  } else if (kind === 'rect') {
    ctx.filter = 'blur(14px)';
    ctx.fillStyle = '#fff';
    ctx.fillRect(size * 0.26, size * 0.3, size * 0.48, size * 0.4);
  } else {
    // Ring at ~69% of the radius (ringRadius / (ringRadius * 1.45)), blurred both ways.
    ctx.filter = 'blur(7px)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = size * 0.09;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.69, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
