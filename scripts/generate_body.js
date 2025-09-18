// scripts/generate_body.js
// 可変長(10–25s or 任意) + BGM合成 + キャッチコピー → final.mp4
// フィルタグラフはファイル渡し(-filter_complex_script)で安定化

import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VIDEOS_DIR   = process.env.VIDEOS_DIR   || path.join(__dirname, '..', 'assets', 'videos', 'en');
const TAGLINES_TXT = process.env.TAGLINES_TXT || path.join(__dirname, '..', 'data', 'en', 'taglines.txt');
const BGM_DIR      = process.env.BGM_DIR      || path.join(__dirname, '..', 'assets', 'bgm', 'en');

const DURATION_SEC = process.env.DURATION_SEC ? Number(process.env.DURATION_SEC) : null;
const MIN_DUR      = Number(process.env.MIN_DUR || 10);
const MAX_DUR      = Number(process.env.MAX_DUR || 25);

const MIX_MODE   = (process.env.MIX_MODE || 'bgm').toLowerCase(); // 'bgm' | 'mix'
const VIDEO_VOL  = Number(process.env.VIDEO_VOL || 1.0);
const BGM_VOL    = Number(process.env.BGM_VOL || 0.25);

const HEADLINE_SECS = Number(process.env.HEADLINE_SECS || 4);
const REAPPEAR_AT   = Number(process.env.REAPPEAR_AT || 11);

// フォント：未指定ならランナー標準の DejaVu を使う
let FONT_FILE = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const OUTPUT  = 'final.mp4';
const TMP_DIR = path.join(__dirname, '..', 'out'); // 一時ファイル置き場
const W = 1080, H = 1920;

const run = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, { stdio: 'inherit' }, e => e ? rej(e) : res()));

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function listFiles(dir, exts) {
  const files = await fs.readdir(dir).catch(() => []);
  return files.filter(f => exts.some(ext => f.toLowerCase().endsWith(ext)))
              .map(f => path.join(dir, f));
}
async function readLines(p) {
  const txt = await fs.readFile(p, 'utf-8');
  return txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
function hasAudioStream(filepath) {
  const r = spawnSync('ffprobe', [
    '-v','error','-select_streams','a:0',
    '-show_entries','stream=codec_type','-of','csv=s=x:p=0', filepath
  ], { encoding:'utf-8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

  // 素材
  const vids = await listFiles(VIDEOS_DIR, ['.mp4','.mov','.mkv','.mp4','.MP4','.MOV']);
  if (!vids.length) throw new Error(`No videos in ${VIDEOS_DIR}`);
  const video = pick(vids);

  const taglines = await readLines(TAGLINES_TXT);
  if (!taglines.length) throw new Error(`No taglines in ${TAGLINES_TXT}`);
  const tagline = pick(taglines);

  const bgmFiles = await listFiles(BGM_DIR, ['.mp3','.wav','.m4a']).catch(() => []);
  const bgm = bgmFiles.length ? pick(bgmFiles) : null;

  const dur = DURATION_SEC ?? (MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR));
  const D   = Math.max(5, Math.min(60, Number(dur.toFixed(2)))); // ガード

  // タイトル/説明を Actions に渡す
  const title = `Rt2112 — ${tagline}`.slice(0, 95);
  const desc  = [
    'Full version & series index:',
    'https://your-landing.example/rt2112',
    '',
    '#RoadTo2112 #ShortStory #SciFi #HumansAndRobots'
  ].join('\n');
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV,
      `VIDEO_TITLE=${title}\nVIDEO_DESC<<EOF\n${desc}\nEOF\nFINAL_MP4=${path.resolve(OUTPUT)}\n`
    );
  }

  // textfile を用意（句読点・特殊文字を安全に）
  const tagFile = path.join(TMP_DIR, 'tagline.txt');
  await fs.writeFile(tagFile, tagline, 'utf8');

  // ----- filter_complex をファイル化 -----
  const appear1To = Math.min(HEADLINE_SECS, D);
  const appear2At = Math.min(REAPPEAR_AT, Math.max(0, D - 0.5));
  const fadeOutSt = (D - 0.35).toFixed(2);
  const aFadeOut  = (D - 0.5).toFixed(2);

  // 映像チェーン
  const vChain = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    `fade=t=in:st=0:d=0.35`,
    `fade=t=out:st=${fadeOutSt}:d=0.35`,
    `drawtext=fontfile=${FONT_FILE}:textfile=${tagFile}:fontsize=72:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,${appear1To})'`,
    `drawtext=fontfile=${FONT_FILE}:textfile=${tagFile}:fontsize=72:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${appear2At},${D})'`,
    `[v]`
  ].join(',');

  // 音声チェーン
  const hasVidAudio = hasAudioStream(video);
  let aChain = '';
  let mapAudio = [];
  if (bgm && MIX_MODE === 'mix' && hasVidAudio) {
    aChain = [
      `[0:a]volume=${VIDEO_VOL}[a0]`,
      `[1:a]volume=${BGM_VOL}[a1]`,
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOut}:d=0.5[aout]`
    ].join(';');
    mapAudio = ['-map','[aout]'];
  } else if (bgm) {
    aChain = `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOut}:d=0.5[aout]`;
    mapAudio = ['-map','[aout]'];
  } else if (hasVidAudio) {
    aChain = `[0:a]volume=${VIDEO_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOut}:d=0.5[aout]`;
    mapAudio = ['-map','[aout]'];
  } else {
    mapAudio = ['-an'];
  }

  const filterGraph = aChain ? `${vChain};${aChain}\n` : `${vChain}\n`;
  const fcPath = path.join(TMP_DIR, 'filters.txt');
  await fs.writeFile(fcPath, filterGraph, 'utf8');
  // ---------------------------------------

  // ffmpeg 実行
  const args = ['-y', '-i', video];
  if (bgm) args.push('-stream_loop','-1','-i', bgm); // 入力側でBGMループ

  args.push(
    '-t', String(D),
    '-filter_complex_script', fcPath,
    '-map', '[v]',
    ...mapAudio,
    '-shortest',
    '-c:v','libx264','-preset','medium','-r','30',
    ...(mapAudio.includes('-an') ? [] : ['-c:a','aac','-b:a','128k']),
    OUTPUT
  );

  await run('ffmpeg', args);
  console.log('✅ generated:', OUTPUT, `(${D}s)`);
  console.log('🎬 source:', path.basename(video));
  if (bgm) console.log('🎵 bgm:', path.basename(bgm), `mode=${MIX_MODE}`);
  console.log('📝 tagline:', tagline);
})();
