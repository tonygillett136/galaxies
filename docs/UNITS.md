# Units

## The system

Internal simulation units, chosen so that G = 1:

| Quantity | Unit |
|---|---|
| Length | 1 kpc |
| Mass | 10^10 solar masses |
| Gravitational constant | 1 (by construction) |

Everything derived follows. Computed numerically, not quoted from memory:

| Quantity | Value |
|---|---|
| Velocity | 207.386530 km/s |
| Time | 4.714920 Myr |

Using G = 4.300917270e-6 kpc (km/s)² / Msun, 1 kpc = 3.085677581e16 km, 1 Myr = 3.1557e13 s.

## Why these

They make galactic dynamics numbers land near 1. A Milky Way-ish disc is a few times 10^10
solar masses, tens of kpc across, with circular speeds around 1 in these units and encounter
timescales of order 100 units. Values near 1 are where floating point behaves and where a
wrong answer looks wrong.

## The rule

**One conversion layer, at the boundary.** Physical units are permitted in three places: the
UI display layer, file readers for observational data, and `src/engine/units.js`. A conversion
appearing anywhere else is a defect, not a convenience.

## How this is enforced

`test/physics.test.js` asserts the derived values above against physical constants, asserts
that all conversions round-trip, and asserts one end-to-end physical case: a Sun-like orbit at
8.2 kpc and 232 km/s comes out at 217.2 Myr, which is the right answer for the right reason.

**The numbers in this document are not the source of truth. The tests are.** If they disagree,
the document is wrong. That is deliberate: a units document that is trusted rather than tested
is precisely how a factor of G survives to production.

## The trap this is guarding against

Unit errors do not raise exceptions. They produce a plausible number wrong by a constant, and
the constant is usually not memorable enough to spot by eye. The classic in this field is a
factor of G; the second is a factor of 2 in the virial theorem. Both look entirely reasonable.
