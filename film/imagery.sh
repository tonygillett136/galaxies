#!/bin/bash
# Act I's opening: real photographs, held long, with a slow push in.
#
# The credit is BURNED INTO THE FRAME. ESA/Hubble material is CC BY 4.0 and video
# use is permitted, but for YouTube the credit has to be on the picture rather
# than in the description — see film/imagery/CREDITS.md and the terms it cites.
# Each credit is on screen for the whole time its image is, unaltered.
#
# Ken Burns is done by pre-scaling well above 4K and cropping a moving window,
# rather than by zoompan on a 4K frame. zoompan resamples what it is given, so
# zooming into an already-downscaled frame softens it exactly where the shot is
# asking the audience to look closely.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
IMG="$HERE/imagery"
OUT="${FILM_OUT:-$HERE/../film4k}"
FONT="/System/Library/Fonts/Supplemental/Futura.ttc"
[ -f "$FONT" ] || FONT="/System/Library/Fonts/HelveticaNeue.ttc"
FPS=60; W=3840; H=2160

# name | seconds | credit
shot () {
  local id=$1 secs=$2 credit=$3 dir=$4
  local frames=$(python3 -c "print(int($secs*$FPS))")
  # Push in over the shot; `dir`=out flips it to a pull back.
  local z0=1.00 z1=1.09
  [ "$dir" = "out" ] && { z0=1.09; z1=1.00; }
  echo "  $id  ${secs}s  ${frames}f  ${z0}->${z1}"
  # None of these images are 16:9, so crop to it BEFORE zooming, or the zoom
  # window drifts against a letterboxed frame. Scale well above 4K first so the
  # zoom crops real pixels instead of resampling a downscaled frame.
  ffmpeg -v error -y -loop 1 -framerate $FPS -t "$secs" -i "$IMG/$id.jpg" \
    -vf "scale=4400:-2:flags=lanczos,crop=4400:2475,\
zoompan=z='$z0+($z1-$z0)*on/$frames':d=1:fps=$FPS:s=${W}x${H}:\
x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',\
setsar=1,\
drawtext=fontfile='$FONT':text='$credit':x=w-tw-64:y=h-th-56:fontsize=34:fontcolor=white@0.72:\
shadowcolor=black@0.85:shadowx=2:shadowy=2" \
    -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r $FPS "$OUT/img_$id.mp4"
}

echo "=== Act I imagery ==="
shot heic0206a 14 "NASA, Holland Ford (JHU), the ACS Science Team and ESA" in
shot potw1345a 13 "ESA/Hubble & NASA" out
shot heic0206h 13 "NASA, Holland Ford (JHU), the ACS Science Team and ESA" in

# Cross-dissolve the three into one segment. 1s dissolves, so the run is
# 11 + 10 + 10 - 2 = 29 seconds.
echo "=== joining ==="
ffmpeg -v error -y \
  -i "$OUT/img_heic0206a.mp4" -i "$OUT/img_potw1345a.mp4" -i "$OUT/img_heic0206h.mp4" \
  -filter_complex "[0][1]xfade=transition=fade:duration=1:offset=13[a];\
[a][2]xfade=transition=fade:duration=1:offset=25[v]" \
  -map "[v]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r $FPS "$OUT/realsky.mp4"
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT/realsky.mp4"
echo "=== realsky.mp4 written ==="
