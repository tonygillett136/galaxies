/**
 * Guided tour.
 *
 * Written to teach the physics in the order the physics actually builds, not in
 * the order the features were implemented. Every claim here has to be one the
 * project can support: where a statement is about our own measurement it says
 * so with the number, and where it is about the literature it is hedged, because
 * a tour is the easiest place in a project for a careful claim to quietly become
 * an overstated one.
 */

export const TOUR = [
  {
    title: 'Two undisturbed discs',
    text: 'Before anything happens. Each galaxy is a disc of massless test particles on '
        + 'circular orbits in its own potential. Left alone they stay put — the simulation '
        + 'asserts that their radii change by less than 0.001 per cent over fifty time units, '
        + 'because a disc that quietly spreads on its own would look exactly like a tidal '
        + 'response later.',
    scenario: 'flyby',
    spec: { rPeri: 30, ecc: 1.8, tStart: -26 },
    time: -24,
    camera: { distance: 70, theta: 0.4, phi: 1.2 },
  },
  {
    title: 'The prograde passage',
    text: 'Now a real encounter. Watch the near sides of the two discs reach towards each '
        + 'other as they pass. The bridge forms first, then the tails: material on the far '
        + 'side is thrown outward while the near side falls inward. Nothing here is scripted — '
        + 'it is gravity acting on particles that were told only to orbit.',
    scenario: 'prograde',
    time: -8, play: true,
    camera: { distance: 66, theta: 0.5, phi: 1.15 },
  },
  {
    title: 'The same orbit, spun the other way',
    text: 'Identical masses, identical pericentre, identical eccentricity, identical epoch. '
        + 'The only change is that both discs now rotate against their orbit instead of with '
        + 'it. The tails almost vanish. Measured on this engine: 15.1 per cent of a disc thrown '
        + 'beyond 20 kpc prograde, against 2.5 per cent retrograde — a ratio of 6.0 — with the '
        + 'two orbits verified identical to one part in a million.',
    scenario: 'retrograde',
    time: 24,
    camera: { distance: 62, theta: 0.9, phi: 1.1 },
  },
  {
    title: 'Where the tail came from',
    text: 'Colour now shows which galaxy each particle started in. The long tails are not '
        + 'shared debris: each one is made almost entirely of its own galaxy’s outer disc, '
        + 'drawn out and left behind. The bridge is the exception, and that is the material '
        + 'genuinely changing hands.',
    scenario: 'prograde',
    time: 22, colourMode: 1,
    camera: { distance: 74, theta: 1.4, phi: 1.0 },
  },
  {
    title: 'A companion through the middle',
    text: 'Fire a small galaxy almost perpendicularly through the centre of a large disc and '
        + 'you get something quite different: a density wave travelling outward as a ring, '
        + 'leaving the centre comparatively empty. The Cartwheel galaxy is the famous example. '
        + 'This is a configuration chosen to show the mechanism, not a fit to that object.',
    scenario: 'ring',
    time: 14, colourMode: 0,
    camera: { distance: 48, theta: 0.2, phi: 0.35 },
  },
  {
    title: 'What the pretty view hides',
    text: 'Press s, or tick Science view. Bloom, the tone curve, the vignette and the dust '
        + 'approximation all switch off, and what is left is a linear readout of particle '
        + 'density. It is much uglier and it is the only view you should ever measure '
        + 'anything from. The beautiful image is not quantitatively readable, and a tool that '
        + 'offers only the beautiful image is inviting you to fool yourself.',
    scenario: 'mice',
    time: 28,
    camera: { distance: 60, theta: 0.7, phi: 1.2 },
  },
  {
    title: 'Against the real sky',
    text: 'Switch to Detect. Those are real SDSS images of real interacting pairs, with the '
        + 'encounter parameters published by Galaxy Zoo: Mergers alongside. Four of the five '
        + 'fitted parameters load into this engine; the fifth is not mapped because its '
        + 'convention has not been read from the paper, and guessing at an angle is how you '
        + 'produce a confident wrong answer. Matching one of these by hand is what Toomre and '
        + 'Toomre did in 1972. Doing it automatically, with honest uncertainties, is what this '
        + 'project is actually for.',
    scenario: 'mice',
    time: 26,
  },
];
