import * as THREE from 'three';
import type { FloorLayout } from '../../state/layout';
import type { LabelPalette, Look } from '../look';
import { paintHub, radialTexture } from '../office';

/**
 * Shared realtime "bake look" for runtime-built offices (module kit and uploaded models), so they read
 * like the authored Day and Evening bakes: the Lead Hub (platform, glowing ring, pedestal with its
 * display), warm lamp pools and a few warm point lights that fade in for the Evening look, a soft
 * contact shadow under the diorama and the entrance mat. The engine's hemisphere, key and fill
 * lights do the rest.
 */

const MAX_POINT_LIGHTS = 4;

export class FloorAmbience {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly pools: THREE.MeshBasicMaterial;
  private readonly poolMesh: THREE.InstancedMesh | null;
  private readonly contact: THREE.MeshBasicMaterial;
  private readonly lights: THREE.PointLight[] = [];
  private readonly hubCanvas: HTMLCanvasElement;
  private readonly hubTexture: THREE.CanvasTexture;
  private readonly shades: THREE.MeshBasicMaterial;

  constructor(layout: FloorLayout, opts: { hub: boolean }) {
    this.group.name = 'ambience';
    const t = layout.template;
    const own = <T extends { dispose(): void }>(x: T) => {
      this.owned.push(x);
      return x;
    };

    // Lead Hub.
    this.hubCanvas = document.createElement('canvas');
    this.hubCanvas.width = 512;
    this.hubCanvas.height = 256;
    this.hubTexture = own(new THREE.CanvasTexture(this.hubCanvas));
    this.hubTexture.colorSpace = THREE.SRGBColorSpace;
    this.hubTexture.anisotropy = 4;
    this.ringMat = own(new THREE.MeshBasicMaterial({ color: '#3b82f6', toneMapped: false }));
    if (opts.hub) {
      const hub = new THREE.Group();
      hub.name = 'kit:hub';
      hub.position.set(layout.hub.x, 0, layout.hub.z);
      const platform = new THREE.Mesh(own(new THREE.CylinderGeometry(t.hub.platformRadius, t.hub.platformRadius + 0.04, 0.05, 48)), own(new THREE.MeshLambertMaterial({ color: '#dfe5ee' })));
      platform.position.y = 0.025;
      platform.receiveShadow = true;
      const ringGeo = own(new THREE.TorusGeometry(t.hub.ringRadius, 0.035, 8, 72));
      ringGeo.rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(ringGeo, this.ringMat);
      ring.position.y = 0.06;
      const pedestal = new THREE.Mesh(own(new THREE.CylinderGeometry(t.hub.machineRadius * 0.8, t.hub.machineRadius, 0.95, 32)), own(new THREE.MeshLambertMaterial({ color: '#e2e6eb' })));
      pedestal.position.y = 0.5;
      pedestal.castShadow = true;
      // Display on top, tilted towards the fixed camera.
      const screen = new THREE.Mesh(own(new THREE.PlaneGeometry(0.9, 0.45)), own(new THREE.MeshBasicMaterial({ map: this.hubTexture, toneMapped: false })));
      const yaw = (t.camera.yawDeg * Math.PI) / 180;
      screen.position.set(Math.sin(yaw) * 0.05, 1.22, Math.cos(yaw) * 0.05);
      screen.rotation.set(-0.45, yaw, 0, 'YXZ');
      const frame = new THREE.Mesh(own(new THREE.BoxGeometry(0.96, 0.5, 0.04)), own(new THREE.MeshLambertMaterial({ color: '#1f2329' })));
      frame.position.copy(screen.position).addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -0.025);
      frame.rotation.copy(screen.rotation);
      hub.add(platform, ring, pedestal, frame, screen);
      this.group.add(hub);
    }

    // Lamp shades (pendants and floor lamps) and warm pools under them.
    this.shades = own(new THREE.MeshBasicMaterial({ color: '#ffd59c', toneMapped: false }));
    const shadeGeo = own(new THREE.CylinderGeometry(0.16, 0.26, 0.18, 20, 1, true));
    const cordMat = own(new THREE.MeshBasicMaterial({ color: '#2a2e35' }));
    const cordGeo = own(new THREE.CylinderGeometry(0.008, 0.008, 1, 4));
    for (const l of t.lamps) {
      const shade = new THREE.Mesh(shadeGeo, this.shades);
      shade.position.set(l.pos[0], l.pos[1], l.pos[2]);
      this.group.add(shade);
      if (l.kind === 'pendant') {
        const cord = new THREE.Mesh(cordGeo, cordMat);
        cord.scale.y = 0.6;
        cord.position.set(l.pos[0], l.pos[1] + 0.39, l.pos[2]);
        this.group.add(cord);
      } else {
        const pole = new THREE.Mesh(cordGeo, cordMat);
        pole.scale.set(2, l.pos[1], 2);
        pole.position.set(l.pos[0], l.pos[1] / 2, l.pos[2]);
        this.group.add(pole);
      }
    }
    const poolTex = own(radialTexture(false));
    this.pools = own(new THREE.MeshBasicMaterial({ map: poolTex, color: 0xffb86b, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const poolGeo = own(new THREE.PlaneGeometry(1, 1));
    poolGeo.rotateX(-Math.PI / 2);
    this.poolMesh = t.lamps.length ? new THREE.InstancedMesh(poolGeo, this.pools, t.lamps.length) : null;
    if (this.poolMesh) {
      const m = new THREE.Matrix4();
      t.lamps.forEach((l, i) => {
        const s = 2.4 + l.pos[1] * 0.9;
        m.makeScale(s, 1, s).setPosition(l.pos[0], 0.014, l.pos[2]);
        this.poolMesh!.setMatrixAt(i, m);
      });
      this.poolMesh.renderOrder = 1;
      this.poolMesh.visible = false;
      this.group.add(this.poolMesh);
    }
    // A few real warm lights for the Evening look (largest rooms first; constant count = no shader recompiles).
    for (const l of t.lamps.slice(0, MAX_POINT_LIGHTS)) {
      const p = new THREE.PointLight('#ffcf8f', 0, 7.5, 1.6);
      p.position.set(l.pos[0], Math.max(1.6, l.pos[1] - 0.2), l.pos[2]);
      this.lights.push(p);
      this.group.add(p);
    }

    // Contact shadow under the diorama and the entrance mat.
    const shadowTex = own(radialTexture(true));
    this.contact = own(new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }));
    const span = Math.max(layout.width, layout.depth);
    const contactGeo = own(new THREE.PlaneGeometry(layout.width + span * 0.5, layout.depth + span * 0.5));
    contactGeo.rotateX(-Math.PI / 2);
    const contact = new THREE.Mesh(contactGeo, this.contact);
    contact.position.set(layout.minX + layout.width / 2 + 0.8, -0.34, layout.minZ + layout.depth / 2 + 0.8);
    contact.renderOrder = -1;
    this.group.add(contact);
    const matGeo = own(new THREE.PlaneGeometry(1.8, 1.1));
    matGeo.rotateX(-Math.PI / 2);
    const mat = new THREE.Mesh(matGeo, own(new THREE.MeshLambertMaterial({ color: '#3a3f47' })));
    mat.position.set(layout.entrance.x, 0.01, layout.entrance.z);
    mat.rotation.y = (t.entrance.facing * Math.PI) / 180;
    mat.receiveShadow = true;
    this.group.add(mat);
  }

  setLook(look: Look) {
    this.ringMat.color.copy(look.hub).multiplyScalar(look.hubLevel);
    this.shades.color.copy(look.lamp).multiplyScalar(0.6 + 0.5 * look.lightMix);
    if (this.poolMesh) {
      const level = look.poolLevel;
      this.poolMesh.visible = level > 0.01;
      this.pools.color.copy(look.pool).multiplyScalar(level);
    }
    for (const l of this.lights) {
      l.intensity = 3.4 * look.lightMix;
      l.color.copy(look.lamp);
    }
    this.contact.opacity = look.contactShadow;
  }

  drawHub(palette: LabelPalette, waiting: number) {
    paintHub(this.hubCanvas, palette, waiting);
    this.hubTexture.needsUpdate = true;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
    this.poolMesh?.dispose();
    for (const l of this.lights) l.dispose();
  }
}
