#!/bin/bash
# Idempotent: a shot whose output already matches its expected duration is skipped,
# so an interrupted run resumes instead of starting over.
SP=.
OUT=$SP/film4k
r () {
  name=$1; want=$2; cfg=$3; script=${4:-./render.mjs}
  if [ -f "$OUT/$name.mp4" ]; then
    have=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/$name.mp4" 2>/dev/null)
    ok=$(python3 -c "print(1 if abs(${have:-0}-$want)<1.0 else 0)")
    [ "$ok" = "1" ] && { echo "skip $name (have ${have}s)"; return; }
  fi
  echo "=== $name ==="; node "$script" "$name" "$cfg"; sleep 2
}
r discs      17 '{"scenario":"prograde","t0":-45,"t1":-44,"seconds":17,"stepsPerFrame":0.35,"theta0":0.0,"thetaSweep":1.4,"phi":1.35,"phiSweep":-0.45,"fixedDist":[100,84],"follow":"primary"}'
r prograde   48 '{"scenario":"prograde","t0":-45,"t1":95,"seconds":48,"stepsPerFrame":2.43,"theta0":0.35,"thetaSweep":0.45,"phi":1.15,"phiSweep":0.15}'
r retrograde 34 '{"scenario":"retrograde","t0":-45,"t1":95,"seconds":34,"stepsPerFrame":3.43,"theta0":0.35,"thetaSweep":0.45,"phi":1.15,"phiSweep":0.15}'
r mice       44 '{"scenario":"mice","t0":-38,"t1":105,"seconds":44,"stepsPerFrame":2.71,"theta0":0.6,"thetaSweep":0.5,"phi":1.1,"phiSweep":0.2}'
r antennae   52 '{"scenario":"antennae","t0":-50,"t1":115,"seconds":52,"stepsPerFrame":2.64,"theta0":0.15,"thetaSweep":0.55,"phi":1.05,"phiSweep":0.25}'
r provenance 34 '{"scenario":"antennae","t0":-50,"t1":110,"seconds":34,"stepsPerFrame":3.92,"theta0":0.9,"thetaSweep":0.35,"phi":1.1,"phiSweep":0.1,"colour":1}'
r ring       44 '{"scenario":"ring","t0":-34,"t1":95,"seconds":44,"stepsPerFrame":2.44,"theta0":0.5,"thetaSweep":0.4,"phi":0.75,"phiSweep":0.45,"margin":1.15}'
r minor      46 '{"scenario":"minorMerger","t0":-42,"t1":100,"seconds":46,"stepsPerFrame":2.57,"theta0":0.4,"thetaSweep":0.45,"phi":1.2,"phiSweep":0.18}'
r merger     64 '{"scenario":"merger","t0":-60,"t1":420,"seconds":64,"stepsPerFrame":6.25,"theta0":0.25,"thetaSweep":0.6,"phi":1.02,"phiSweep":0.22,"margin":1.1}'
r cu_prograde 6.9 '{"scenario":"prograde","t0":6,"t1":26,"seconds":6.9,"stepsPerFrame":2.43,"theta0":0.7,"thetaSweep":0.18,"phi":1.2,"phiSweep":0.05,"fixedDist":[95,78],"follow":"primary"}'
r cu_mice     6.2 '{"scenario":"mice","t0":22,"t1":42,"seconds":6.2,"stepsPerFrame":2.71,"theta0":0.85,"thetaSweep":0.15,"phi":1.12,"phiSweep":0.05,"fixedDist":[105,88],"follow":"primary"}'
r cu_antennae 7.9 '{"scenario":"antennae","t0":32,"t1":57,"seconds":7.9,"stepsPerFrame":2.64,"theta0":0.45,"thetaSweep":0.2,"phi":1.08,"phiSweep":0.06,"fixedDist":[110,90],"follow":"secondary"}'
r cu_ring     6.8 '{"scenario":"ring","t0":4,"t1":24,"seconds":6.8,"stepsPerFrame":2.44,"theta0":0.62,"thetaSweep":0.16,"phi":0.62,"phiSweep":0.12,"fixedDist":[92,76],"follow":"primary"}'
r cu_merger   8.0 '{"scenario":"merger","t0":300,"t1":360,"seconds":8.0,"stepsPerFrame":6.25,"theta0":0.6,"thetaSweep":0.2,"phi":1.05,"phiSweep":0.08,"fixedDist":[85,62],"follow":"pair"}'
r reversal   40 '{"scenario":"prograde","t0":-45,"t1":45,"seconds":40,"stepsPerFrame":3.1,"theta0":0.45,"thetaSweep":0.4,"phi":1.12,"phiSweep":0.12,"fixedDist":[185,255]}' ./render_reversal.mjs
r detect     28 '{"scenario":"prograde","t0":60,"t1":110,"seconds":28,"stepsPerFrame":1.49,"theta0":0.5,"thetaSweep":0.0,"phi":1.15,"phiSweep":0.0,"fixedDist":[191.25,191.25]}' ./render_detect.mjs
echo "ALL 4K RENDERS COMPLETE"
