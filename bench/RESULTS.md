# Measured N-body throughput

**Measured 2026-08-14, ~21:55 BST.** Apple M4, 10 GPU cores, 24 GB unified memory.
Chrome 151, WebGPU, adapter reports `vendor=apple arch=metal-3`.
Harness: `bench/nbody_bench.html`.

These replace the arithmetic estimate made before the machine was measured. The estimate was
6e10 pair-interactions/s and 32k particles at 60 fps for self-gravity. Both were the right
order and both were pessimistic by roughly a factor of two.

## Restricted: N massless test particles, K=2 rigid potentials, O(N·K)

| N | ms/step | steps/s | evaluations/s |
|---|---|---|---|
| 65,536 | 0.0127 | 78,818 | 1.03e10 |
| 262,144 | 0.1335 | 7,493 | 3.93e9 |
| 1,048,576 | 0.6678 | 1,497 | 3.14e9 |
| 4,194,304 | 2.6759 | 374 | 3.13e9 |
| 8,388,608 | 5.2674 | 190 | 3.19e9 |

## Direct all-pairs self-gravity, O(N²)

| N | ms/step | steps/s | pair-interactions/s |
|---|---|---|---|
| 4,096 | 0.204 | 4,906 | 8.23e10 |
| 8,192 | 0.754 | 1,327 | 8.91e10 |
| 16,384 | 2.561 | 390 | 1.05e11 |
| 32,768 | 9.341 | 107 | 1.15e11 |
| 65,536 | 37.00 | 27 | 1.16e11 |
| 131,072 | 147.4 | 7 | 1.17e11 |

## What these mean

**Direct self-gravity saturates at 1.16e11 pair-interactions per second.** The rate is flat
from N=32k upward, which is what a properly saturated GPU looks like. Interactive self-gravity
is comfortable to 32k particles and usable to 65k.

**Restricted saturates at about 3.1e9 particle-updates per second, and it is memory-bound, not
compute-bound.** Each particle does only two force evaluations but moves 64 bytes. At 8.4M
particles that is 537 MB per step in 5.27 ms, about 102 GB/s, close to this part's memory
bandwidth. Adding more arithmetic per particle is therefore nearly free; adding more particles
is not.

## The consequence for the architecture

**The interactive tier is rendering-bound, not physics-bound.** One million test particles
cost 0.67 ms of a 16.7 ms frame budget, about 4 per cent. The engineering effort belongs in
the renderer, and we can afford a particle count high enough that the galaxy reads as
continuous light rather than as visible dots.

**The inference tier is tractable on a desktop.** A 100k-particle forward model at ~0.07
ms/step gives a 500-step encounter in about 35 ms. A 200-iteration gradient descent, counting
a backward pass at roughly forward cost, lands near 14 seconds per fit. Reproducing Galaxy
Zoo's 10^5 random samples per system would take about an hour, for work that took three
million human classifications in 2016.

## Caveat, stated because it will otherwise be misread

**These are physics-only numbers with nothing rendered.** They are not application frame
rates. The measured application figure, separately, is 300,000 test particles at 60 fps /
16.7 ms with the full render path — and that number is meaningless without the N beside it.

## The bug that produced a spectacular wrong answer first

The first run reported up to **8.6e14 pair-interactions per second**, roughly 17 PFLOPS on a
10-core integrated GPU.

Cause: pipelines created with `layout: 'auto'`. WebGPU's automatic layout omits any binding
the entry point does not statically reference. The `direct` kernel never touches the
`massives` buffer at binding 0, so binding 0 was absent from its generated layout, every bind
group was rejected as invalid, every dispatch was silently dropped, and the timer measured an
empty command buffer.

Two fixes, and the second matters more:

1. An **explicit** `GPUBindGroupLayout` shared by both pipelines, so the layout does not vary
   with what a shader happens to reference.
2. **A read-back assertion**: copy the position buffer back after the run and confirm the
   particles actually moved, plus a check that the reported rate is below a physical ceiling
   derived from the hardware. A benchmark that can return a number without the kernel
   executing is not a slow instrument, it is a broken one, and the number it returns is
   unfalsifiable by inspection. Every row above carries an `ok` from these checks.
