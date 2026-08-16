#!/usr/bin/env python3
"""Builds script.json from narration_v2, so the two cannot drift apart."""
import json, os, sys
SP = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SP)
from narration_v2 import NARRATION_V2 as N

segments = [
  dict(id='title', kind='card', seconds=10,
       title='GRAVITY, AND ENOUGH TIME',
       sub='How galaxies pull each other apart, and what they become', lines=N[0]),
  dict(id='realsky', clip='realsky', title='The sky, photographed',
       params='Hubble and ESA imagery  ·  credits on frame', lines=N[1]),
  dict(id='control', clip='control_live', title='A galaxy, undisturbed',
       params='150,000 stars, self-gravitating  ·  the arms are not imposed', lines=N[2]),
  dict(id='prograde', clip='prograde', title='A close passage',
       params='equal mass  ·  25 kpc  ·  discs turning with the encounter', lines=N[3] + N[4]),
  dict(id='retrograde', clip='retrograde', title='The same orbit, reversed',
       params='identical encounter  ·  discs turning against it', lines=N[5]),
  dict(id='mice', clip='mice', title='The Mice',
       params='closer pass  ·  both discs gently inclined', lines=N[6]),
  dict(id='antennae', clip='antennae', title='Out of the plane',
       params='16 kpc  ·  bound orbit  ·  discs steeply inclined', lines=N[7]),
  dict(id='provenance', clip='provenance', title='Whose stars are whose',
       params='every star coloured by the galaxy it was born in', lines=N[8]),
  dict(id='detect', clip='detect', title='Against the real sky',
       params='simulation over photograph  ·  matched scale  ·  nothing fitted', lines=N[9]),
  dict(id='ring', clip='ring', title='A ring, not a tail',
       params='small companion  ·  straight through the disc', lines=N[10]),
  dict(id='minor', clip='minor', title='The ordinary case',
       params='companion at one tenth the mass  ·  a returning orbit', lines=N[11]),
  dict(id='merger', clip='merger', title='What becomes of spirals that meet',
       params='bound orbit  ·  dynamical friction  ·  coalescence at 1685 Myr', lines=N[12]),
  dict(id='home', clip='discs', title='Andromeda',
       params='the Milky Way has a large neighbour, and the two are approaching', lines=N[13]),
  dict(id='close', kind='card', seconds=22,
       title='RUN IT YOURSELF', sub='galaxies.gillett-projects.com', lines=N[14]),
]
json.dump({'segments': segments}, open(os.path.join(SP, 'script.json'), 'w'), indent=1)
print(f"  {len(segments)} segments, "
      f"{sum(len(s['lines']) for s in segments)} lines, "
      f"{sum(len(l.split()) for s in segments for l in s['lines'])} words")
