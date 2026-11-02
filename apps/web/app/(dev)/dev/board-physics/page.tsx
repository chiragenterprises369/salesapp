'use client';

import { DevFrame } from '../dev-frame';
import { PhysicsLab } from './physics-lab';

/** Board physics demo (frontend-physics): live config sliders, slow motion, quality tiers, stress data. */
export default function DevBoardPhysicsPage() {
  return (
    <DevFrame title="Board physics" persona="company_admin">
      <PhysicsLab />
    </DevFrame>
  );
}
