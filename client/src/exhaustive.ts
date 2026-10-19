// Compile-time exhaustiveness check for a switch over a union: the default
// branch only type-checks while every member of the union has a case, and does
// nothing at run time (a value outside the union is ignored as before).
export function exhaustive(_value: never): void {}
