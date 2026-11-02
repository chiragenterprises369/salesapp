/** Byte and JSON fixtures for the change #19 specs (no app imports, safe for unit tests). */

// ---------------------------------------------------------------- fixtures (bytes)

/** 1x1 PNG. */
export const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Minimal valid GLB 2.0 (JSON chunk only). */
export function makeGlb(asset: Record<string, unknown> = { asset: { version: '2.0' }, scenes: [{ nodes: [] }], scene: 0 }): Buffer {
  let json = Buffer.from(JSON.stringify(asset), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'latin1');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(json.length, 0);
  chunk.write('JSON', 4, 'latin1');
  return Buffer.concat([header, chunk, json]);
}

/** Stored (uncompressed) zip with the given entries; enough for the central-directory checks. */
export function makeZip(entries: Array<{ name: string; data: Buffer | string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Fake APK: a zip with AndroidManifest.xml and classes.dex. */
export const makeApk = (extra = '') => makeZip([
  { name: 'AndroidManifest.xml', data: `manifest${extra}` },
  { name: 'classes.dex', data: 'dex\n035' },
]);

/** google-services.json for the employee app (fake but well-formed ids). */
export function googleServicesJson(projectId = 'vistar-test-123', packageName = 'app.vistar.employee'): string {
  return JSON.stringify({
    project_info: { project_number: '123456789012', project_id: projectId, storage_bucket: `${projectId}.appspot.com` },
    client: [
      {
        client_info: { mobilesdk_app_id: '1:123456789012:android:abcdef0123456789', android_client_info: { package_name: packageName } },
        api_key: [{ current_key: 'AIzaSyA-1234567890abcdefghijklmnopqrstu' }],
      },
    ],
  });
}

/** Service account key file (fake key: never used to reach Google in tests). */
export function serviceAccountJson(projectId = 'vistar-test-123'): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: projectId,
    private_key_id: 'abcdef0123456789abcd',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
    client_email: `firebase-adminsdk@${projectId}.iam.gserviceaccount.com`,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

/** A small valid Vistar floor plan (format layout_json). */
export function floorPlan(seats = 4): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'vistar.floor-plan',
    name: 'Test office',
    units: 'm',
    size: { width: 20, depth: 12 },
    rooms: [
      { id: 'work-area', name: 'Sales floor', kind: 'work_area', polygon: [[0, 0], [14, 0], [14, 12], [0, 12]] },
      { id: 'cabin-1', name: 'Cabin', kind: 'cabin', polygon: [[14, 0], [20, 0], [20, 6], [14, 6]], walls: 'glass' },
    ],
    items: [{ kind: 'desk_pod_4', position: [4, 4], roomId: 'work-area' }],
    seats: Array.from({ length: seats }, (_, i) => ({ id: `d${i + 1}`, kind: 'desk', position: [2 + i, 3], rotation: 0, roomId: 'work-area', label: `Desk ${i + 1}` })),
  };
}
