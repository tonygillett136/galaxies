# The film

How the 4K60 showcase was made: the picture, the narration and the music, all
generated from this repository.

**Watch it:** *(YouTube link once published)*
**Run the simulation yourself:** https://galaxies.gillett-projects.com

The finished film is 3840x2160 at 60 frames per second, 7 minutes 40 seconds,
with a spoken narration and an original score. Nothing in it is stock footage,
stock music, or a recording of a screen.

---

## Contents

- [The one decision that shaped everything](#the-one-decision-that-shaped-everything)
- [Picture](#picture)
- [Edit](#edit)
- [Narration](#narration)
- [Music](#music)
- [Mix](#mix)
- [Reproducing it](#reproducing-it)
- [What went wrong](#what-went-wrong)

---

## The one decision that shaped everything

The first version was captured with Playwright's built-in video recorder, which
is a **screen recorder**. That caps output at 25 frames per second, ties frame
rate to how fast the machine happens to render, and means "make it 60fps" is
simply not available.

Then one measurement changed the approach:

| | cost per frame at 3840x2160 |
|---|---|
| rendering a frame | **17.9 ms** |
| reading that frame back out of the browser | **132 ms** |

Rendering in 4K is nearly free. The expensive part is capture. And capture speed
does not matter at all if you stop trying to record in real time.

So the pipeline is an **offline renderer**, not a recorder:

1. step the simulation by a fixed amount
2. capture that exact frame
3. repeat

Playback frame rate becomes a free choice. The film captures at about 7 frames
per second and plays at 60. Every one of its 27,576 frames is a distinct
simulation state, so the motion is genuinely 60fps rather than interpolated.

Frames are piped straight into ffmpeg. 29,000 4K stills would be roughly 40 GB
on disk and there is no reason for them to touch it.

---

## Picture

`render.mjs` drives a headless-ish Chrome at 3840x2160, hides every piece of app
chrome, and renders the shot deterministically.

### Framing is measured, not guessed

Before shooting, the renderer seeks to the first and last epoch of the shot and
measures the **98.5th percentile particle radius** about the pair's midpoint. The
camera dolly is then derived from that extent, so every shot fills the frame by
the same amount:

```
distance = extent / tan(fov / 2) * margin
```

The app's own `contentRadius()` is separation-based and ignores the tails, which
is exactly what a tidal shot needs to contain. Hence the separate measurement.

### Camera

Each shot carries a slow continuous orbit (`thetaSweep`), an optional polar drift
(`phiSweep`) and an eased dolly between the two measured distances. Nothing snaps.

### Exposure is pinned

The application scales splat intensity with backing-store area, because a splat
covers a fixed *world* size and spreads its light over more pixels as resolution
rises. That is correct for a browser window and wrong for a film: at 4K it
applies a **4.0x** boost against 1.04x at 1080p, and the first 4K frames clipped
at 252 where the 1080p reference peaked at 217.

The renderer pins `intensity x resComp` to the 1080p value, so the grade is
identical at any render size.

### Shots

`shots.sh` is the shot list, and it is **idempotent**: a shot whose output
already matches its expected duration is skipped, so an interrupted run resumes
instead of starting over. Sixteen shots in total, nine wides, five close-ups and
two specials.

Two shots need their own renderer:

- `render_reversal.mjs` runs the simulation forward, then flips the sign of the
  timestep and runs it back. The camera drifts out and returns with it. It ends
  at the exact epoch it started.
- `render_detect.mjs` selects a real SDSS target, enters Detect mode so the
  observation is scaled correctly, and cross-fades the photograph under the model.

### Close-ups

Each close-up was rendered at the **same steps-per-frame** as the wide shot it
interrupts. That is the whole trick: the simulation clock advances at the same
rate through the cut, so it reads as a camera move rather than a jump in time.
`assemble.py` computes where those epochs fall in the wide shot and splices them
in, with shorter dissolves than the scene transitions so they feel like a beat.

---

## Edit

`assemble.py` builds the finished film.

- **Titles and parameter briefings** fade in and out over the first seven
  seconds of each scene. The parameters shown are the real scenario definitions
  from `src/engine/encounter.js`, not typed by hand.
- **No scrim.** An earlier cut laid a tinted bar behind the type for legibility.
  ffmpeg's `drawbox` has no alpha expression, so the bar stayed for the whole
  segment while the type it existed for faded after seven seconds. The type now
  carries its own drop shadow, which fades with it.
- **Cross-dissolves** of 1.0s between scenes, 0.45s into and out of a close-up.

### One timeline, three outputs

The cut, the subtitles and the chapter markers are all derived from **the same
timeline object**, computed once. A subtitle file built from a separate estimate
of the cut points drifts, and the drift is invisible until somebody watches the
whole thing.

---

## Narration

`narration.py` holds the script and generates the subtitle file.
`voice.py` turns that subtitle file into speech.

### The voice

**Kokoro** (82M parameter neural TTS, ONNX, running locally), voice `bm_lewis`.
Chosen by measurement rather than by name, across the four British male voices
available:

| voice | median pitch | intonation range |
|---|---|---|
| bm_daniel | 129.7 Hz | 3.20 semitones |
| bm_fable | 119.4 Hz | 4.73 |
| bm_george | 143.7 Hz | 3.60 |
| **bm_lewis** | **96.0 Hz** | **4.99** |

Low and expressive is the documentary profile.

The first attempt used macOS `say` with the voice "Daniel". That is a compact
formant synthesiser from a much older generation and it announced itself
immediately. Swapping the engine was the fix; no amount of tuning rescues it.

**This is a synthesiser, and it is not an imitation of any real person.** The
writing borrows a register. The voice does not borrow an identity.

### Sentences, not cues

The important detail. Subtitles are split at clause boundaries so they are
comfortable to read. Feeding those fragments to a TTS engine one at a time gives
it no idea what comes next, and produces the flat, chopped delivery that makes
synthetic narration obvious.

So the 131 cues are grouped into **80 whole sentences**, synthesised as complete
utterances, then anchored back to the first cue's timestamp. The engine places
its own stress and cadence across the full line, and picture, subtitles and voice
stay in step.

### Fitting speech to picture

Each sentence must fit the gap before the next one. `voice.py`:

- raises the speaking rate slightly if a line will not fit (0.92 nominal, 1.18 ceiling)
- lets a long sentence **borrow up to half a second** of the silence before it,
  which is imperceptible against the picture and far better than a collision
- **reports any remaining overrun, by timestamp**, instead of writing audio on
  top of the next line

The build prints `no sentence overruns its slot: nothing collides` when clean.

`narration.py` separately reports the implied **speaking rate per segment** and
flags anything above about 2.65 words per second, which is too dense to read.

### Write numbers as words

`1972` is spoken longhand and costs nearly a second against `nineteen seventy
two`. Every figure in the script is spelled out.

---

### Refitting words to a finished picture

The 4K segment renders are large and transient; the words get revised long after
they have been deleted. `narration.py` therefore measures segment durations from
the renders when they exist and otherwise falls back to
`film/segment_durations.json`, recovered from the shipped cut and verified to
reproduce its 459.6s total exactly. Rewriting a line must never silently retime
the picture.

Two allocator defects surfaced the first time the words were revised against a
locked cut, both of which had been reporting themselves for weeks at a magnitude
that read as noise:

- **Cue slots were allocated by character count alone.** Speaking a line costs a
  fixed amount (onset, breath, the pause after it) plus a per-character amount,
  so short lines were systematically starved while long lines sat on slack:
  "The stars never touch." was allotted 1.38s and needs 1.49s. The weight is now
  affine, `20 + len(line)`.
- **`voice.py` corrected an overlong sentence once and gave up.** Duration is not
  exactly inversely proportional to Kokoro's `speed` parameter, so a single
  correction with a 2% margin lands short and the line still collides by around a
  tenth of a second. It now iterates to the fit, capped at `MAX_SPEED` so the
  voice never sounds hurried.

The overrun report that found both was already there, and had already been
printing them. A check that fires and is not read is not a check.

## Music

`score.py`. Original composition, written for this film, in the idiom of early
1980s analog synthesiser scoring. The idiom is a technique, not a work: stacked
detuned sawtooths, very slow harmonic movement and a long reverb are how that
sound is made, and nothing here reproduces any existing piece.

### How it is built

Everything is synthesised from scratch in numpy. No samples, no instruments.

- **Pad** — the core sound. Each note is five sawtooth oscillators detuned by
  -7, -3, 0, +4 and +9 cents, built additively, voiced as a triad across two
  octaves. The beating between detuned oscillators is what makes it move.
- **Filter sweep** — a second-order lowpass whose cutoff opens slowly across each
  chord, from 420 Hz to about 4 kHz depending on intensity. Applied in 64 blocks
  with overlap, which is a cheap way to get a time-varying filter.
- **Sub drone** — a sine at the root, one octave down.
- **Bell arpeggio** — sine plus two inharmonic partials with an exponential
  decay, entering only where the film opens out.
- **Reverb** — convolution with a synthetic impulse response: 3.4 seconds of
  exponentially decaying noise, lowpassed at 5.2 kHz, with a 20 ms pre-delay.
  Applied with overlap-add.
- **Stereo** — the pad drifts slowly across the image on a 23-second cycle so it
  never sits still.

### Harmony and structure

`i - VI - III - VII` in D minor, at **12 seconds per chord**. Spacious,
unresolved, and it can turn over indefinitely without demanding attention.

An `intensity(t)` curve keyed to the cut controls level, filter opening and
whether the arpeggio plays at all: sparse under the control, opening at the
first tidal tail, largest at the merger, resolving under the closing card.

### Verifying music you cannot hear

The composition was checked by measurement, not by ear. FFT of a window inside
the first chord:

| pitch | level |
|---|---|
| D3, F3, A3, D4, F4, A4 | present, within 13 dB of peak |
| C4, B3 (not in the chord) | **-83 dB** |

Notes outside the chord are absent, so the synthesis is genuinely playing the
harmony rather than making noise. Spectral distance across a chord boundary is
3.67, confirming the progression actually moves.

---

## Mix

`mix.filter` is the ffmpeg filter graph.

- narration gets a high-pass at 95 Hz, a small dip at 250 Hz, a presence lift at
  3.2 kHz, and a short slap echo so it sits in the same space as the music
- the music bed sits at 0.45 gain and is **side-chained to the voice**, ducking a
  further 10.3 dB while narration plays
- the final mix is normalised to **-14.6 LUFS, -1.5 dBTP**, at YouTube's target

### Balance the ratio, not the duck depth

The number that matters is not how deep the duck is, it is **how far the voice
sits above the music while the voice is speaking**. Broadcast practice for
narration over a bed is 12 to 18 dB.

The first mix had a respectable-looking 7.3 dB duck and was still wrong: the bed
was loud enough underneath that the measured speech-to-music ratio was **1.4 dB**.
The narration and the score were effectively the same loudness, which is exactly
what it sounded like. Lowering the bed and deepening the duck brings it to
**14.0 dB**, with the music resting at -26.9 dBFS between lines: present, and not
competing.

Measure the ratio on the **stems**, during speech only. Measuring the finished
mix compares voice-plus-music against music and tells you almost nothing.

Ducking depth has to be measured on the **music stem alone**. Measuring the
finished mix compares voice-plus-ducked-music against music, which is not the
question, and reports a duck of about 1 dB whatever the setting.

---

## Reproducing it

Requirements: Node with `playwright-core`, Python 3 with `numpy` and `scipy`,
`ffmpeg`, and for narration `kokoro-onnx`, `soundfile` and `espeak-ng`.

```bash
# 0. serve the simulation
python3 ../bench/devserver.py 8787

# 1. render every shot (about 75 minutes; resumable)
FILM_OUT=./out bash shots.sh

# 2. cut the film, and emit subtitles and chapters from the same timeline
python3 assemble.py

# 3. compose the score
python3 score.py 459.6 score_full.wav

# 4. speak the narration
python3 voice.py

# 5. mix, then mux
ffmpeg -i score_full.wav -i narration.wav -/filter_complex mix.filter \
       -map "[out]" -c:a pcm_s16le soundtrack.wav
ffmpeg -i galaxies_showcase_4k60.mp4 -i soundtrack.wav -map 0:v -map 1:a \
       -c:v copy -c:a aac -b:a 320k -ar 48000 -movflags +faststart out.mp4
```

The TTS model files are not in the repository. `kokoro-v1.0.onnx` (310 MB) and
`voices-v1.0.bin` (27 MB) come from the kokoro-onnx releases page.

---

## What went wrong

In keeping with the rest of this repository, the defects are recorded rather
than tidied away. Every one was found by measurement, and several were found
only because a viewer said something looked wrong.

**The scrim that would not leave.** A tinted bar drawn for legibility stayed for
the whole segment because `drawbox` has no alpha expression, while the text it
existed for faded after seven seconds.

**The first cut was 4.9 minutes, not 10.** The shots rendered faster than
assumed. Re-shot at half the steps per frame: same epochs, twice the duration,
and more graceful motion.

**The merger segment showed the app's own interface.** The first trim detector
assumed the setup phase is static and looked for the last long freeze. True for
every scenario except the merger, whose preflight seek spans 480 time units and
visibly animates. It placed that segment's start twenty seconds early. Replaced
with a detector keyed on the HUD going dark, then verified by sampling every
segment and measuring the corner luminance.

**4K was overexposed by my own bug fix.** See [Exposure](#exposure-is-pinned).

**The narration collided with itself at 1:05.** Reported by ear, then found
exactly: one sentence needed 4.10s in a 2.67s slot and overran by 1.43 seconds.
The synthesiser had been raising the speaking rate and then writing the audio
anyway. The check written to find it turned up **six** overrunning sentences, not
one. All are now clear, and the build fails loudly rather than quietly overlapping.

**Three verification instruments were wrong before the code was.** A dev server
that served its own repo root rather than the working directory, so mutated
copies were never tested; `curl` without `-L` fetching an empty redirect body;
and a pitch tracker locking onto the score's D-minor pad rather than the voice.
In each case the fix was the same: measure the thing itself, in isolation, rather
than something downstream of it.
