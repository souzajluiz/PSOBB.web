// Area light table (`lightentry.bin`, loose or in data.gsl, 0x1980 bytes =
// 96 entries of 0x44). From PsoBB.exe:
//   FUN_00793f64  picks entry DAT_00aafc9c (area) + 0x30 when FUN_0078b220() != 0,
//                 then FUN_00794034 copies it to DAT_00a9d460..0x4a0
//   FUN_00795898  light direction  -> FUN_00843a68 (D3DLIGHT9.Direction, transformed by
//                 the inverse of the current matrix, i.e. given in camera space)
//   FUN_00793ef0  light color      -> FUN_00843a38 (D3DLIGHT9.Diffuse)
//   FUN_00794200  ambient color    -> FUN_00843980 (D3DRS_AMBIENT)
//   FUN_00794a80 / FUN_00794548 (models, objects): D3DRS_AMBIENT = grey(ambient_level),
//                 direction, color, then SetLight (FUN_00843af8)
//
// Entry (17 floats):
//   00 f32[3] vector written by the light editor from two angles (FUN_004e3084); not used for drawing
//   0C f32[3] direction (camera space, unit length; default 0,0,1)
//   18 f32[2] unused at run time (0.3, 0.96 in most entries)
//   20 f32    ambient level, D3DRS_AMBIENT = (l, l, l) for models and objects
//   24 f32    unused (alpha of the color)
//   28 f32[3] light color r, g, b
//   34 f32    unused
//   38 f32[3] ambient color r, g, b (set once when the area loads)

export const LIGHT_ENTRY_SIZE = 0x44;
export const LIGHT_ALT_OFFSET = 0x30;

export interface LightEntry {
  editorVector: [number, number, number];
  direction: [number, number, number];
  unknown18: [number, number];
  ambientLevel: number;
  color: [number, number, number];
  ambientColor: [number, number, number];
}

export function parseLightEntries(data: Uint8Array): LightEntry[] {
  if (data.length % LIGHT_ENTRY_SIZE !== 0) throw new Error(`lightentry size ${data.length} is not a multiple of 0x44`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const f = (o: number) => dv.getFloat32(o, true);
  const v3 = (o: number): [number, number, number] => [f(o), f(o + 4), f(o + 8)];
  const out: LightEntry[] = [];
  for (let o = 0; o < data.length; o += LIGHT_ENTRY_SIZE) {
    out.push({
      editorVector: v3(o),
      direction: v3(o + 0x0c),
      unknown18: [f(o + 0x18), f(o + 0x1c)],
      ambientLevel: f(o + 0x20),
      color: v3(o + 0x28),
      ambientColor: v3(o + 0x38),
    });
  }
  return out;
}

// alt: FUN_0078b220() != 0 (the client also loads fogentry_a.dat then).
export function lightForArea(entries: LightEntry[], area: number, alt = false): LightEntry | null {
  return entries[area + (alt ? LIGHT_ALT_OFFSET : 0)] ?? null;
}
