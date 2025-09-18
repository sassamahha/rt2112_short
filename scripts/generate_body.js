// scripts/generate_body.js
// Rt2112 Shorts: 9:16動画を可変長で生成（BGM合成＋中央コピー常時表示対応）→ final.mp4
//
// ■ 使うENV（Actionsのenvで渡すだけ）
//   VIDEOS_DIR=assets/videos/en
//   TAGLINES_TXT=data/en/taglines.txt
//   BGM_DIR=assets/bgm/common              # 省略可（無音）
//
//   DURATION_SEC=15                        # 任意固定秒。未指定なら MIN_DUR〜MAX_DUR からランダム
//   MIN_DUR=10  MAX_DUR=25
//
//   MIX_MODE=bgm|mix                       # bgm=映像音なし+BGM / mix=映像音+bgmミックス
//   VIDEO_VOL=1.0  BGM_VOL=0.28
//
//   // 文字表示（広告モード）
//   ALWAYS_ON_COPY=1                       # 1でコピーを尺いっぱい中央表示（最後0.8秒前に消す）
//   HEADLINE_SECS=3                        # ALWAYS_ON_COPY=0のときの冒頭表示秒
//   REAPPEAR_AT=11                         # 同上：再表示開始秒（未使用なら大きい値でもOK）
//   TAIL_OFF_SEC=0.8                       # 終了直前に消すバッファ（秒）
//
//   // レイアウト
//   INSET_PCT=0.94                         # 0.80〜1.00：画面を縮小して余白をpad（UI衝突回避）
//   TAG_POS=top|center|bottom              # コピー位置（既定 center）
//   COPY_BOX_OPACITY=0.35                  # 半透明ボックス(0〜1)、0でボックス無し
//
//   // フォント
//   FONT_FILE=/path/to/SomeFont.ttf        # 省略可。未指定なら DejaVuSans-Bold を自動使用
//
// GitHub Actionsへタイトル/説明を渡す：VIDEO_TITLE, VIDEO_DESC, FINAL_MP4

import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 入力
const VIDEOS_DIR   = process.env.VIDEOS_DIR   || path.join(__dirname, '..', 'assets', 'videos', 'en');
const TAGLINES_TXT = process.env.TAGLINES_TXT || path.join(__dirname, '..', 'data', 'en', 'taglines.txt');
const BGM_DIR      = process.env.BGM_DIR      || path.join(__dirname, '..', 'assets', 'bgm', 'en');

// 長さ
const DURATION_SEC = process.env.DURATION_SEC ? Number(process.env.DURATION_SEC) : null;
const MIN_DUR      = Number(process.env.MIN_DUR || 10);
const MAX_DUR      = Number(process.env.MAX_DUR || 25);

// 音声
const MIX_MODE  = (process.env.MIX_MODE || 'bgm').toLowerCase(); // 'bgm'|'mix'
const VIDEO_VOL = Number(process.env.VIDEO_VOL || 1.0);
const BGM_VOL   = Number(process.env.BGM_VOL   || 0.28);

// テキスト
const ALWAYS_ON_COPY = process.env.ALWAYS_ON_COPY === '1';
const HEADLINE_SECS  = Number(process.env.HEADLINE_SECS || 3);
const REAPPEAR_AT    = Number(process.env.REAPPEAR_AT || 11);
const TAIL_OFF_SEC   = Number(process.env.TAIL_OFF_SEC || 0.8);

// レイアウト
const INSET_PCT = Number(process.env.INSET_PCT || 1.0); // 0.80〜1.00
const TAG_POS   = (process.env.TAG_POS || 'center').toLowerCase();
const COPY_BOX_OPACITY = Number(process.env.COPY_BOX_OPACITY || 0.35);

// フォント
let   FONT_FILE = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// 出力
const OUTPUT  = 'final.mp4';
const TMP_DIR = path.join(__dirname, '..', 'out');
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
  await fs.mkdir(TMP_DIR, { recursive: true });

  // 素材
  const vids = await listFiles(VIDEOS_DIR, ['.mp4','.mov','.mkv','.MP4','.MOV']);
  if (!vids.length) throw new Error(`No videos in ${VIDEOS_DIR}`);
  const video = pick(vids);

  const taglines = await readLines(TAGLINES_TXT);
  if (!taglines.length) throw new Error(`No taglines in ${TAGLINES_TXT}`);
  const tagline = pick(taglines);

  const bgmFiles = await listFiles(BGM_DIR, ['.mp3','.wav','.m4a']).catch(() => []);
  const bgm = bgmFiles.length ? pick(bgmFiles) : null;

  // 尺
  const dur = DURATION_SEC ?? (MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR));
  const D   = Math.max(5, Math.min(60, Number(dur.toFixed(2)))); // セーフガード

  // タイトル/説明（Actionsへ受け渡し）
  const title = `Road to 2112 — ${tagline}`.slice(0, 95);
  const desc  = [
    'https://hub.sassamahha.me',
    '',
    '#RoadTo2112 #ShortStory #SciFi #HumansAndRobots'
  ].join('\n');
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV,
      `VIDEO_TITLE=${title}\nVIDEO_DESC<<EOF\n${desc}\nEOF\nFINAL_MP4=${path.resolve(OUTPUT)}\n`
    );
  }

  // drawtext用：本文ではなく広告コピー。textfile方式で安全。
  const tagFile = path.join(TMP_DIR, 'tagline.txt');
  await fs.writeFile(tagFile, tagline, 'utf8');

  // タイミング計算
  const appear1To  = ALWAYS_ON_COPY ? Math.max(0, D - TAIL_OFF_SEC) : Math.min(HEADLINE_SECS, D);
  const appear2At  = ALWAYS_ON_COPY ? 9999 : Math.min(REAPPEAR_AT, Math.max(0, D - 0.5));
  const appear2End = Math.max(0, D - TAIL_OFF_SEC).toFixed(2);

  const fadeOutSt = (D - 0.35).toFixed(2);
  const aFadeOut  = (D - 0.5).toFixed(2);

  // 文字位置
  const tagYExpr =
    TAG_POS === 'top'    ? 'h*0.12' :
    TAG_POS === 'bottom' ? 'h*0.82-text_h' :
                            '(h-text_h)/2';

  // 余白（インセット）
  const innerW = Math.round(W * Math.min(1, Math.max(0.8, INSET_PCT)));
  const innerH = Math.round(H * Math.min(1, Math.max(0.8, INSET_PCT)));

  // drawtext共通（半透明ボックスON/OFF）
  const textCommon =
    `fontfile=${FONT_FILE}:textfile=${tagFile}:fontsize=72:fontcolor=white:borderw=3:bordercolor=black` +
    (COPY_BOX_OPACITY > 0 ? `:box=1:boxcolor=black@${COPY_BOX_OPACITY}:boxborderw=18` : '');

  // ---- filter_complex をファイルに出力（クォート事故防止）----
  const vFilters = [
    `[0:v]scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`,
    `fade=t=in:st=0:d=0.35`,
    `fade=t=out:st=${fadeOutSt}:d=0.35`,
    `drawtext=${textCommon}:x=(w-text_w)/2:y=${tagYExpr}:enable='between(t,0,${appear1To})'`
  ];
  if (!ALWAYS_ON_COPY) {
    vFilters.push(
      `drawtext=${textCommon}:x=(w-text_w)/2:y=${tagYExpr}:enable='between(t,${appear2At},${appear2End})'`
    );
  }
  const vChain = vFilters.join(',') + `[v]`; // ← [v] はカンマ無しで直結

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
  // ----------------------------------------------------

  // ffmpeg 実行
  const args = ['-y', '-i', video];
  if (bgm) args.push('-stream_loop','-1','-i', bgm); // BGMは入力側でループ

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
