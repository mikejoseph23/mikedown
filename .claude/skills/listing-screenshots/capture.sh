#!/bin/zsh
# Captures the Marketplace/README/website screenshots defined in shots.json.
#
#   capture.sh                     all shots (interactive ones pause for you)
#   capture.sh --unattended        only shots without a prompt
#   capture.sh --interactive       only shots with a prompt
#   capture.sh --only a,b          just these shot names
#   capture.sh --list              print shot names and whether they need you
#   capture.sh --promote [a,b]     copy staged images over the published ones
#
# Env: MDSHOTS_POS=x,y (window origin), MDSHOTS_SETTLE=secs (render wait, default 4),
#      MDSHOTS_AI_SETTINGS=file.json (mikedown.ai.engines/routing for the AI shots),
#      MDSHOTS_KEEP=1 (leave each window open until Enter), CODE_APP, MDSHOTS_OUT.
#
# Each shot: fresh VS Code profile in /tmp/mdshots, this checkout of MikeDown and
# the stager helper (stager/) symlinked in as extensions, the window sized from shots.json,
# then `screencapture -l` of that one window. Only the VS Code process this
# script starts is ever killed. Outputs go to assets/screenshots/_new/ (README +
# Marketplace size, with shadow) and _new/site/ (website size, window only).
#
# Needs: macOS, a Retina display, Screen Recording + Accessibility permission for
# the terminal, `npm run compile` done first.

set -euo pipefail

SKILL_DIR=${0:A:h}
REPO=${SKILL_DIR:h:h:h}
SHOTS_JSON=$SKILL_DIR/shots.json
DOCS=$REPO/assets/sample-docs
OUT=${MDSHOTS_OUT:-$REPO/assets/screenshots/_new}
CODE_APP=${CODE_APP:-"/Applications/Visual Studio Code.app"}
CODE_BIN="$CODE_APP/Contents/MacOS/Code"
# Short paths on purpose: long --user-data-dir paths overflow the socket path limit
# and VS Code exits silently.
PROFILE=/tmp/mdshots
EXTDIR=/tmp/mdshots-ext
BIN=/tmp/mdshots-bin
SETTLE=${MDSHOTS_SETTLE:-4}

README_W=1312; README_H=1068   # assets/screenshots (Marketplace + README)
SITE_W=1198;   SITE_H=953      # website/vscode, cropped to the window
README_Q=85; SITE_Q=70           # sips quality; lands near the current file sizes

mode=all; only=""; promote=""
while (( $# )); do
  case $1 in
    --unattended) mode=unattended ;;
    --interactive) mode=interactive ;;
    --only) only=$2; shift ;;
    --list) mode=list ;;
    --promote) mode=promote; [[ ${2:-} != --* && -n ${2:-} ]] && { promote=$2; shift; } ;;
    -h|--help) sed -n '2,20p' $0; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

json() { node -e "const s=require('$SHOTS_JSON');$1"; }

names=($(json "
  const only='$only'.split(',').filter(Boolean), mode='$mode';
  for (const x of s.shots) {
    if (only.length && !only.includes(x.name)) continue;
    if (mode==='unattended' && x.prompt) continue;
    if (mode==='interactive' && !x.prompt) continue;
    console.log(x.name);
  }"))

if [[ $mode == list ]]; then
  json "for (const x of s.shots) console.log(x.name.padEnd(20), x.prompt ? 'needs you' : 'unattended')"
  exit 0
fi

if [[ $mode == promote ]]; then
  # README/Marketplace copies always; website copies only for images the page already uses.
  for f in $OUT/*.jpg(N); do
    n=${f:t:r}
    [[ -n $promote && ",$promote," != *",$n,"* ]] && continue
    cp $f $REPO/assets/screenshots/ && echo "assets/screenshots/${f:t}"
    if [[ -f $OUT/site/${f:t} && ( -f $REPO/website/vscode/${f:t} || ",$promote," == *",$n,"* ) ]]; then
      cp $OUT/site/${f:t} $REPO/website/vscode/ && echo "website/vscode/${f:t}"
    fi
  done
  exit 0
fi

[[ -x $CODE_BIN ]] || { echo "VS Code not found at $CODE_APP (set CODE_APP)" >&2; exit 1; }
[[ -f $REPO/dist/extension.js && -f $REPO/out/webview/editor-main.js ]] || { echo "Run npm run compile first" >&2; exit 1; }
mkdir -p $BIN $OUT/site
[[ -x $BIN/winid && $BIN/winid -nt $SKILL_DIR/winid.swift ]] || swiftc -O -o $BIN/winid $SKILL_DIR/winid.swift

PID=""
quit_ours() {
  [[ -n $PID ]] || return 0
  if kill -0 $PID 2>/dev/null; then
    touch $PROFILE/quit   # the stager runs workbench.action.quit
    for _ in {1..20}; do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
    kill -0 $PID 2>/dev/null && kill $PID 2>/dev/null
    for _ in {1..10}; do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
    kill -0 $PID 2>/dev/null && kill -9 $PID 2>/dev/null || true
  fi
  PID=""
  rm -rf $PROFILE $EXTDIR
}
trap 'quit_ours' EXIT INT TERM

write_profile() {  # $1 = shot name
  rm -rf $PROFILE $EXTDIR; mkdir -p $PROFILE/User $EXTDIR
  # MikeDown and the stager go in as symlinked "installed" extensions rather than
  # --extensionDevelopmentPath, which stamps "[Extension Development Host]" on the
  # title bar. rm -rf of $EXTDIR only unlinks them.
  local ver=$(node -p "require('$REPO/package.json').version")
  ln -s $REPO $EXTDIR/interapp.mikedown-editor-$ver
  ln -s $SKILL_DIR/stager $EXTDIR/mikedown-dev.mikedown-shot-stager-0.0.1
  node -e "
    const fs=require('fs'), cfg=require('$SHOTS_JSON'), shot=cfg.shots.find(x=>x.name==='$1');
    const settings={
      'workbench.colorTheme': shot.theme==='light' ? 'Default Light Modern' : 'Default Dark Modern',
      'workbench.startupEditor': 'none',
      'workbench.tips.enabled': false,
      'workbench.enableExperiments': false,
      'workbench.welcomePage.walkthroughs.openOnInstall': false,
      'workbench.secondarySideBar.defaultVisibility': 'hidden',
      'workbench.editorAssociations': { '*.md': 'mikedown.editor', '*.markdown': 'mikedown.editor' },
      'editor.minimap.enabled': false,
      'window.restoreWindows': 'none',
      'security.workspace.trust.enabled': false,
      'update.mode': 'none',
      'extensions.ignoreRecommendations': true,
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
      'telemetry.telemetryLevel': 'off',
      'git.enabled': false,
      'chat.disableAIFeatures': true,
      'chat.commandCenter.enabled': false,
      'mikedown.ai.enabled': !!shot.ai,
      ...(shot.settings||{}),
    };
    // Optional: a JSON file with mikedown.ai.engines / routing for the AI shots (no keys, ever).
    const extra=process.env.MDSHOTS_AI_SETTINGS;
    if (shot.ai && extra) Object.assign(settings, JSON.parse(fs.readFileSync(extra,'utf8')));
    fs.writeFileSync('$PROFILE/User/settings.json', JSON.stringify(settings,null,2));
    fs.writeFileSync('$PROFILE/shot.json', JSON.stringify(shot,null,2));
  "
}

size_window() {  # position and size by AX (no activation in the same call: it drops the resize)
  local x y w h got
  read x y w h < <(json "const w=s.window;console.log(w.x,w.y,w.width,w.height)")
  # MDSHOTS_POS=x,y moves it, e.g. onto a display nobody else is driving.
  [[ -n ${MDSHOTS_POS:-} ]] && { x=${MDSHOTS_POS%,*}; y=${MDSHOTS_POS#*,}; }
  for _ in 1 2 3; do
    osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID)
      set position of window 1 to {$x, $y}
      set size of window 1 to {$w, $h}
    end tell" >/dev/null 2>&1 || true
    sleep 0.5
    got=$(osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID) to get size of window 1" 2>/dev/null || true)
    [[ $got == "$w, $h" ]] && return 0
  done
  echo "   window size is $got, wanted $w, $h" >&2
}

# Resize to width $3, then crop or pad (white) to exactly $3 x $4, JPEG quality $5.
to_jpg() {  # $1 in.png $2 out.jpg $3 w $4 h $5 quality
  local tmp=${2:r}.tmp.png
  sips -s format png --resampleWidth $3 $1 --out $tmp >/dev/null
  local hh=$(sips -g pixelHeight $tmp | awk '/pixelHeight/{print $2}')
  if (( hh > $4 )); then sips -c $4 $3 $tmp >/dev/null
  elif (( hh < $4 )); then sips -p $4 $3 --padColor FFFFFF $tmp >/dev/null; fi
  sips -s format jpeg -s formatOptions $5 $tmp --out $2 >/dev/null
  rm -f $tmp
}

capture_one() {  # $1 = shot name
  local name=$1 prompt
  prompt=$(json "console.log(s.shots.find(x=>x.name==='$name').prompt||'')")
  echo "== $name"
  write_profile $name
  env -u ELECTRON_RUN_AS_NODE -u VSCODE_IPC_HOOK_CLI -u VSCODE_PID -u VSCODE_CWD \
    MDSHOTS_DIR=$PROFILE "$CODE_BIN" --new-window --user-data-dir $PROFILE --extensions-dir $EXTDIR \
    $DOCS >$BIN/code-$name.log 2>&1 &
  PID=$!
  local wid=""
  for _ in {1..120}; do wid=$($BIN/winid $PID 2>/dev/null || true); [[ -n $wid ]] && break; sleep 0.5; done
  [[ -n $wid ]] || { echo "   no window for pid $PID, skipped" >&2; quit_ours; return 1; }
  size_window
  for _ in {1..120}; do [[ -f $PROFILE/staged ]] && break; sleep 0.5; done
  [[ -f $PROFILE/staged ]] || echo "   stager did not report back; capturing anyway" >&2
  sleep $SETTLE
  size_window
  $BIN/winid $PID --activate >/dev/null || true
  if [[ -n $prompt ]]; then
    echo "   >> $prompt"
    echo -n "   Press Enter to capture (s to skip): "
    local answer; read -r answer </dev/tty
    [[ $answer == s ]] && { quit_ours; return 0; }
    sleep 0.5
  fi
  wid=$($BIN/winid $PID --activate)
  screencapture -x -l$wid $BIN/$name-shadow.png
  screencapture -x -o -l$wid $BIN/$name-window.png
  to_jpg $BIN/$name-shadow.png $OUT/$name.jpg $README_W $README_H $README_Q
  to_jpg $BIN/$name-window.png $OUT/site/$name.jpg $SITE_W $SITE_H $SITE_Q
  rm -f $BIN/$name-*.png
  echo "   $OUT/$name.jpg"
  # MDSHOTS_KEEP=1 leaves the window open (and the profile) for poking at; Enter quits it.
  if [[ -n ${MDSHOTS_KEEP:-} ]]; then echo -n "   kept pid $PID, Enter to quit it: "; read -r </dev/tty || true; fi
  quit_ours
}

for n in $names; do capture_one $n || true; done
echo "Review the images in $OUT before promoting (capture.sh --promote)."
