// The float-to-int step of the damage path. The exe's damage conversions run
// `fistp` under a control word with RC = 11 (`or 0xc00`, fldcw), which is
// truncation toward zero, not round-half-even: EntityHitEntity_00773350 (chop at
// 0x00773823, 0x007738fd, 0x00773925, 0x0077398a), entity_hit_by_tech 0x00773afc
// (all 28 fistp chop, the resta case included), unknown_melee_attack_2 0x006997a0
// (0x00699887, 0x0069999a, 0x00699b41). The HP loss, the damage number and the
// 6x0A total a boss sends are all this conversion, so sender and receiver agree.
// Math.trunc is the same as the chop for every finite value the port makes.
export function chopToInt(x: number): number {
  return Math.trunc(x);
}
