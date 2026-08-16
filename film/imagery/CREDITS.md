# Imagery credits

ESA/Hubble images are released under **CC BY 4.0**. Commercial and video use is
permitted, but for YouTube the credit must be **burned into the frame** rather
than left in the description — verified at https://esahubble.org/copyright/ on
2026-08-16. The credit wording below must appear unaltered.

| file | object | credit (burn in, unaltered) |
|---|---|---|
| `heic0206a.jpg` | Tadpole Galaxy, UGC 10214 / Arp 188 (4360x3798) | NASA, Holland Ford (JHU), the ACS Science Team and ESA |
| `potw1345a.jpg` | Antennae Galaxies, NGC 4038/4039 | ESA/Hubble & NASA |
| `heic0206h.jpg` | The Mice, NGC 4676 | NASA, Holland Ford (JHU), the ACS Science Team and ESA |

Each object and credit line was read from its own ESA/Hubble page rather than
inferred from the file ID. That check earned its keep: `potw2036a`, guessed at as
an interacting pair, turned out to be the globular cluster NGC 1805 and was
discarded.

The 512x512 SDSS cutouts under `data/targets/images/` are a separate matter. They
carry SDSS's own attribution requirements and are far too small to hold a 4K
frame; they are used only as matched overlays in the Detect beat, at the size
they were fetched for.

## Two images rejected, and why

`potw2036a` was fetched on a guess that the ID was an interacting pair. It is the
globular cluster NGC 1805. Reading the object from its own page rather than
trusting the filename caught it immediately.

`heic0812a` is a **collage**: two panels separated by a hard black divider,
measured at x = 1186..1217 of 3000. Its left panel is 1186x1773 — portrait, and
far below 4K once cropped to 16:9. The ESA page said so in words ("This collage
combines..."); the pixels confirmed it. Unusable as a held full-frame shot.

`heic0812c` shows the Antennae with their full tidal tails and would have been
ideal, but it is credited solely to **Robert Gendler**. ESA/Hubble's CC BY 4.0
covers ESA/Hubble's own material; an image credited to a private astrophotographer
is not obviously theirs to sublicense, and "probably fine" is not a licence.
Replaced with `potw1345a`, credited "ESA/Hubble & NASA".
