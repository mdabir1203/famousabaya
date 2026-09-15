// build-final.cjs
// v1.2.30 keynote final build
// - trims 6 input clips to storyboard durations
// - concatenates them into a 30s video
// - mixes 6 VO lines at their storyboard timestamps (one per scene)
// - outputs v1.2.30-keynote-16x9.mp4 and v1.2.30-keynote-9x16.mp4
//
// VO script (human + technical, ~8 words each so it fits in each scene):
//   VO 1 (0.6s)  "Every worker. Every swipe. One screen — live."
//   VO 2 (5.5s)  "It's right. But it's not right now."
//   VO 3 (10.8s) "The answer is up to ten seconds old."
//   VO 4 (16.5s) "Now it hears every swipe — the second it happens."
//   VO 5 (22.5s) "Same data. Same screen. Just — the right now."
//   VO 6 (27.5s) "Live, again."

const path = require('path');
const { spawnSync } = require('child_process');
const ffmpegPath = path.resolve(
  __dirname,
  'ffmpeg-deps',
  'node_modules',
  'ffmpeg-static',
  'ffmpeg.exe'
);

const CLIPS_DIR = path.resolve(__dirname, 'clips');
const VO_DIR = path.resolve(__dirname, 'vo');
const OUT_16x9 = path.resolve(__dirname, 'v1.2.30-keynote-16x9.mp4');
const OUT_9x16 = path.resolve(__dirname, 'v1.2.30-keynote-9x16.mp4');

// Storyboard target durations (seconds)
const TARGETS = [5, 5, 6, 6, 5, 2]; // total 29s — within 30s budget
const CLIP_NAMES = [
  'scene-01.mp4',
  'scene-02.mp4',
  'scene-03.mp4',
  'scene-04.mp4',
  'scene-05.mp4',
  'scene-06.mp4',
];
// VO start timestamps (ms) — one per scene, at the 0.6-1.0s mark of the scene.
const VO_TIMES_MS = [600, 5500, 10800, 16500, 22500, 27500];
const VO_FILES = [
  'vo-line-01.mp3',
  'vo-line-02.mp3',
  'vo-line-03.mp3',
  'vo-line-04.mp3',
  'vo-line-05.mp3',
  'vo-line-06.mp3',
];

function run(label, args) {
  console.log(`[ffmpeg] ${label}`);
  const r = spawnSync(ffmpegPath, args, { stdio: 'pipe', encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('--- FAILED ---');
    console.error('stdout:', r.stdout);
    console.error('stderr:', r.stderr);
    throw new Error('ffmpeg failed: ' + label);
  } else if (r.stderr) {
    // ffmpeg logs to stderr; just tail the last line for the user
    const lines = r.stderr.split('\n').filter(Boolean);
    if (lines.length) console.log('  >', lines[lines.length - 1]);
  }
  console.log('  -> ok');
}

// Step 1: trim each clip to its target duration
const trimmedPaths = [];
for (let i = 0; i < CLIP_NAMES.length; i++) {
  const src = path.join(CLIPS_DIR, CLIP_NAMES[i]);
  const dst = path.join(CLIPS_DIR, `scene-${String(i + 1).padStart(2, '0')}-trim.mp4`);
  trimmedPaths.push(dst);
  run(`trim ${CLIP_NAMES[i]} -> ${TARGETS[i]}s`, [
    '-y', '-i', src,
    '-t', String(TARGETS[i]),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-pix_fmt', 'yuv420p', '-r', '24',
    '-an',  // no audio in intermediate clips
    dst,
  ]);
}

// Step 2: build the concat demuxer file (one line per trimmed clip, absolute paths with forward slashes)
const concatList = path.join(CLIPS_DIR, 'concat-list.txt');
require('fs').writeFileSync(
  concatList,
  trimmedPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n') + '\n'
);

// Step 3: concat trimmed clips (video only for now)
const concatTmp = path.join(CLIPS_DIR, 'concat-tmp.mp4');
run('concat 6 trimmed clips', [
  '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-r', '24',
  concatTmp,
]);

// Step 4: mix VO + final encode
// Build adelay for each VO at the right timestamp, then amix into one track.
const TARGET_TOTAL = TARGETS.reduce((a, b) => a + b, 0);

// Dynamically build the ffmpeg args:
//   - inputs: concatTmp + 6 VO files
//   - filter_complex: 6 adelay+apad chains, then a 6-input amix
const voPaths = VO_FILES.map((f) => path.join(VO_DIR, f));
const inputArgs = ['-y', '-i', concatTmp, ...voPaths.flatMap((p) => ['-i', p])];

const adelayChains = VO_TIMES_MS.map((ms, i) => {
  // Each VO input is 1-indexed in ffmpeg (concatTmp is 0, VOs are 1..6)
  return `[${i + 1}:a]adelay=${ms}|${ms},apad=pad_dur=2[a${i + 1}];`;
}).join('');
const amixInputs = VO_TIMES_MS.map((_, i) => `[a${i + 1}]`).join('');
const filterComplex =
  adelayChains +
  `${amixInputs}amix=inputs=${VO_TIMES_MS.length}:duration=first:dropout_transition=0:normalize=0[aout]`;

run(`final mix (concat + ${VO_TIMES_MS.length} VO adelay + amix + libx264)`, [
  ...inputArgs,
  '-filter_complex', filterComplex,
  '-map', '0:v',
  '-map', '[aout]',
  '-t', String(TARGET_TOTAL),  // hard cap to the trimmed-concat length
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-r', '24',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  OUT_16x9,
]);

console.log('\n=== DONE ===');
console.log('16:9 final:', OUT_16x9);

// Step 5: optional 9:16 — vertical crop (center). The 16:9 video has the action
// concentrated in the middle horizontally, so a center crop gives a clean
// 9:16 mobile story version without re-rendering the source clips.
run('9:16 center crop (9:16 from 16:9)', [
  '-y', '-i', OUT_16x9,
  '-vf', "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920",
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-r', '24',
  '-c:a', 'copy',
  '-movflags', '+faststart',
  OUT_9x16,
]);

console.log('9:16 final:', OUT_9x16);
console.log('\nShipped. Both files are at:');
console.log('  ', OUT_16x9);
console.log('  ', OUT_9x16);
