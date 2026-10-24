// The advanced effects setting (get_settings_advanced_effect_ -> get_settings_advanced_effect,
// dump 202696, returns g_settings_advanced_effect). The exe reads it from the registry's external
// settings and clamps it to 0..1 (dump 202859..202863), so it is a switch.
//
// Its readers in the model particle branch (update_particle_effect_single_particle, dump 291946):
// a particle with the cloak flag 0x400 is drawn only when this is on (through the cloak), and the
// Seabed capture trap's cloak (render/traps.ts captureTrapDraw) is the same switch.
//
// ASSUMED: the port has no settings screen for it yet, and the default is on (the value the trap
// draw already passes). The exe's default when the registry has no value is not traced.

let on = true;

export function advancedEffectsOn(): boolean {
  return on;
}

export function setAdvancedEffects(value: boolean): void {
  on = value;
}
