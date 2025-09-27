// scripts/generate_body.js (fixed: freeze tail, no black padding)
import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ========= 入力パス ========= */
const VIDEOS_DIR   = process.env.VIDEOS_DIR   || path.join(__dirname, '..', 'assets', 'videos', 'en');
const TAGLINES_TXT = process.env.TAGLINES_TXT || path.join(__dirname, '..', 'data', 'en', 'taglines.txt');
const BGM_DIR      = process.env.BGM_DIR      || path.join(__dirname, '..', 'assets', 'bgm', 'common');

/* ========= 長さ ========= */
const DURATION_SEC = process.env.DURATION_SEC ? Number(process.env.DURATION_SEC) : null;
const MIN_DUR      = Number(process.env.MIN_DUR || 10);
const MAX_DUR      = Number(process.env.MAX_DUR || 25);

/* アウトロと安全余白（本編の枠を確保する）*/
const OUTRO_SEC    = Number(process.env.OUTRO_SEC || 3.0);    // 末尾アウトロ（ロゴ/固定コピーなど）
const SAFETY_SEC   = Number(process.env.SAFETY_SEC || 0.40);  // 丸め対策の余白

/* 末尾ホールド（黒を足さず、最後のフレームを静止保持）*/
const HOLD_LAST_SEC = Number(process.env.HOLD_LAST_SEC || 0.8);

/* 黒パッドはデフォルト無効（必要なら明示的に >0 に）。*/
const END_PAD_SEC  = Number(process.env.END_PAD_SEC || 0);

/* ========= 音声 ========= */
const MIX_MODE  = (process.env.MIX_MODE || 'bgm').toLowerCase(); // 'bgm'|'mix'
const VIDEO_VOL = Number(process.env.VIDEO_VOL || 1.0);
const BGM_VOL   = Number(process.env.BGM_VOL   || 0.28);

/* ========= 表示 ========= */
const ALWAYS_ON_COPY = process.env.ALWAYS_ON_COPY === '1';
const HEADLINE_SECS  = Number(process.env.HEADLINE_SECS || 3);
const REAPPEAR_AT    = Number(process.env.REAPPEAR_AT || 11);
const TAIL_OFF_SEC   = Number(process.env.TAIL_OFF_SEC || 0.8);

/* ========= レイアウト ========= */
const FIT_MODE  = (process.env.FIT_MODE || 'cover').toLowerCase(); // 'cover'|'contain'
const INSET_PCT = Number(process.env.INSET_PCT || 1.0);            // 0.80〜1.00
const TAG_POS   = (process.env.TAG_POS || 'center').toLowerCase();

/* ========= テキスト・帯 ========= */
let   FONT_FILE = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_SIZE = Number(process.env.FONT_SIZE || 72);
const MAX_LINES = Number(process.env.MAX_LINES || 2);
const TEXT_MARGIN_PCT = Number(process.env.TEXT_MARGIN_PCT || 0.06);  // 折返し用安全幅
const TEXT_COLOR = process.env.TEXT_COLOR || 'white';
const TEXT_BORDERW = Number(process.env.TEXT_BORDERW || 3);
const TEXT_BORDERCOLOR = process.env.TEXT_BORDERCOLOR || 'black';

/* ========= フル幅帯 ========= */
const BAR_COLOR   = process.env.BAR_COLOR || 'black';
const BAR_OPACITY = Number(process.env.BAR_OPACITY ?? 0.35);
const BAR_PAD_PX  = Number(process.env.BAR_PAD_PX || 96);

/* ========= 出力 ========= */
const OUTPUT  = 'final.mp4';
const TMP_DIR = path.join(__dirname, '..', 'out');
const W = 1080, H = 1920;

/* ========= ユーティリティ ========= */
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

/* テキストの自動改行（おおよそでOK） */
function wrapCopy(text, fontSize, marginPct, maxLines = 2) {
  const safeW = W * (1 - 2 * Math.max(0, Math.min(0.2, marginPct)));
  const avgCharW = fontSize * 0.56;
  const maxChars = Math.max(8, Math.floor(safeW / avgCharW));
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const cand = cur ? cur + ' ' + w : w;
    if (cand.length <= maxChars) cur = cand;
    else {
      lines.push(cur); cur = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (cur) lines.push(cur);
  return lines.join('\n');
}

/* ========= メイン ========= */
(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });

  const vids = await listFiles(VIDEOS_DIR, ['.mp4','.mov','.mkv','.MP4','.MOV']);
  if (!vids.length) throw new Error(`No videos in ${VIDEOS_DIR}`);
  const video = pick(vids);

  const taglines = await readLines(TAGLINES_TXT);
  if (!taglines.length) throw new Error(`No taglines in ${TAGLINES_TXT}`);
  const taglineRaw = pick(taglines);
  const taglineWrapped = wrapCopy(taglineRaw, FONT_SIZE, TEXT_MARGIN_PCT, MAX_LINES);

  const bgmFiles = await listFiles(BGM_DIR, ['.mp3','.wav','.m4a']).catch(() => []);
  const bgm = bgmFiles.length ? pick(bgmFiles) : null;

  /* ===== 尺 ===== */
  const durTotal = DURATION_SEC ?? (MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR));
  const D        = Math.max(5, Math.min(60, Number(durTotal.toFixed(2))));    // 総尺
  const D_BODY   = Math.max(3, D - OUTRO_SEC - SAFETY_SEC);                   // 本編終端（見せ場ここまで）

  /* ===== タイトル/説明（Actionsへ） ===== */
  const TITLE_PREFIX = process.env.TITLE_PREFIX || 'Road to 2112';
  const title = `${TITLE_PREFIX} — ${taglineRaw}`.slice(0, 95);
  const desc  = ['https://hub.sassamahha.me', '', '#RoadTo2112 #ShortStory #SciFi #HumansAndRobots'].join('\n');
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV,
      `VIDEO_TITLE=${title}\nVIDEO_DESC<<EOF\n${desc}\nEOF\nFINAL_MP4=${path.resolve(OUTPUT)}\n`
    );
  }

  /* drawtext用テキストはファイル経由（クォート安全） */
  const tagFile = path.join(TMP_DIR, 'tagline.txt');
  await fs.writeFile(tagFile, taglineWrapped, 'utf8');

  /* ===== タイミング（本編終端 D_BODY を基準） ===== */
  const appear1To  = ALWAYS_ON_COPY ? Math.max(0, D_BODY - TAIL_OFF_SEC) : Math.min(HEADLINE_SECS, D_BODY);
  const appear2At  = ALWAYS_ON_COPY ? 9999 : Math.min(REAPPEAR_AT, Math.max(0, D_BODY - 0.5));
  const appear2End = Math.max(0, D_BODY - TAIL_OFF_SEC).toFixed(2);

  // テキスト・帯だけ終盤で消す（映像はフェードアウトしない）
  const box1Enable = `between(t,0,${appear1To})`;
  const txt1Enable = `between(t,0,${appear1To})`;
  const box2Enable = `between(t,${appear2At},${appear2End})`;
  const txt2Enable = `between(t,${appear2At},${appear2End})`;

  /* ===== フィット ===== */
  const inset = Math.min(1, Math.max(0.8, INSET_PCT || 1));
  let fitFilters;
  if (FIT_MODE === 'cover') {
    fitFilters = [`scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`];
    if (inset < 1) {
      const innerW = Math.round(W * inset), innerH = Math.round(H * inset);
      fitFilters.push(`scale=${innerW}:${innerH}`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`);
    }
  } else {
    const innerW = Math.round(W * inset), innerH = Math.round(H * inset);
    fitFilters = [`scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`];
  }

  /* ===== 帯サイズと位置 ===== */
  const BAR_H = Math.round(FONT_SIZE + BAR_PAD_PX * 2);
  let yBar;
  if (TAG_POS === 'top')         yBar = Math.round(H * 0.12);
  else if (TAG_POS === 'bottom') yBar = Math.round(H * 0.82 - BAR_H);
  else                           yBar = Math.round((H - BAR_H) / 2);
  const textYExpr = `(${yBar}+(${BAR_H}-text_h)/2)`;

  /* ===== テキスト共通 ===== */
  const textCommon = `fontfile=${FONT_FILE}:textfile=${tagFile}:fontsize=${FONT_SIZE}:fontcolor=${TEXT_COLOR}:borderw=${TEXT_BORDERW}:bordercolor=${TEXT_BORDERCOLOR}`;

  /* ===== 映像フィルタ =====
     - 映像の fade-out は廃止
     - 最後は tpad=clone で静止保持（HOLD_LAST_SEC）
  */
  const vFilters = [
    `[0:v]${fitFilters.join(',')}`,
    `fade=t=in:st=0:d=0.35`,
    `drawbox=x=0:y=${yBar}:w=${W}:h=${BAR_H}:color=${BAR_COLOR}@${BAR_OPACITY}:t=fill:enable='${box1Enable}'`,
    `drawtext=${textCommon}:x=(w-text_w)/2:y=${textYExpr}:enable='${txt1Enable}'`
  ];
  if (!ALWAYS_ON_COPY) {
    vFilters.push(
      `drawbox=x=0:y=${yBar}:w=${W}:h=${BAR_H}:color=${BAR_COLOR}@${BAR_OPACITY}:t=fill:enable='${box2Enable}'`,
      `drawtext=${textCommon}:x=(w-text_w)/2:y=${textYExpr}:enable='${txt2Enable}'`
    );
  }
  // 末尾ホールド（映像を黒にせず止め絵で延長）
  vFilters.push(`tpad=stop_mode=clone:stop_duration=${HOLD_LAST_SEC}`);

  const vChain = vFilters.join(',') + `[v]`;

  /* ===== 音声 ===== */
  const hasVidAudio = hasAudioStream(video);
  const aFadeOutStart = Math.max(0, D - 0.5 - SAFETY_SEC).toFixed(2); // 総尺終端に合わせて少し早めに
  let aChain = '';
  let mapAudio = [];
  if (bgm && MIX_MODE === 'mix' && hasVidAudio) {
    aChain = [
      `[0:a]volume=${VIDEO_VOL}[a0]`,
      `[1:a]volume=${BGM_VOL}[a1]`,
      `[a0][a1]amix=inputs=2:duration=longest:dropout_transition=2,afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOutStart}:d=0.5[aout]`
    ].join(';');
    mapAudio = ['-map','[aout]'];
  } else if (bgm) {
    aChain = `[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOutStart}:d=0.5[aout]`;
    mapAudio = ['-map','[aout]'];
  } else if (hasVidAudio) {
    aChain = `[0:a]volume=${VIDEO_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOutStart}:d=0.5[aout]`;
    mapAudio = ['-map','[aout]'];
  } else {
    mapAudio = ['-an'];
  }

  /* ===== filter_complex をファイル化 ===== */
  const filterGraph = aChain ? `${vChain};${aChain}\n` : `${vChain}\n`;
  const fcPath = path.join(TMP_DIR, 'filters.txt');
  await fs.writeFile(fcPath, filterGraph, 'utf8');

  /* ===== ffmpeg 実行 =====
     - 総尺は D（HOLD_LAST_SECはフィルタ内で確保）
     - 映像は黒にフェードしない
  */
  const args = ['-y', '-i', video];
  if (bgm) args.push('-stream_loop','-1','-i', bgm);
  args.push(
    '-t', String(D),
    '-filter_complex_script', fcPath,
    '-map', '[v]',
    ...mapAudio,
    '-c:v','libx264','-preset','medium','-r','30',
    '-pix_fmt','yuv420p',
    '-video_track_timescale','30000',
    '-g','60','-sc_threshold','0',
    ...(mapAudio.includes('-an') ? [] : ['-c:a','aac','-b:a','128k']),
    OUTPUT
  );

  await run('ffmpeg', args);
  console.log('✅ generated:', OUTPUT, `(${D}s, body=${D_BODY.toFixed(2)}s, outro=${OUTRO_SEC}s, safety=${SAFETY_SEC}s, hold=${HOLD_LAST_SEC}s)`);
  console.log('🎬 source:', path.basename(video));
  if (bgm) console.log('🎵 bgm:', path.basename(bgm), `mode=${MIX_MODE}`);
  console.log('📝 tagline:', taglineWrapped.replace(/\n/g,' / '));

  /* ===== 黒の物理連結はデフォ無効 =====
     どうしても黒が必要なときだけ END_PAD_SEC > 0 にして使う。
  */
  if (END_PAD_SEC > 0) {
    const padded = 'final_padded.mp4';
    const color  = `color=size=${W}x${H}:rate=30:color=black`;
    const anull  = `anullsrc=channel_layout=stereo:sample_rate=48000`;
    const hadAudio = !mapAudio.includes('-an');

    const padArgs = hadAudio
      ? [
          '-y',
          '-i', OUTPUT,
          '-f','lavfi','-t', String(END_PAD_SEC), '-i', color,
          '-f','lavfi','-t', String(END_PAD_SEC), '-i', anull,
          '-filter_complex', '[0:v][0:a][1:v][2:a]concat=n=2:v=1:a=1[v][a]',
          '-map','[v]','-map','[a]',
          '-c:v','libx264','-r','30','-pix_fmt','yuv420p',
          '-c:a','aac','-b:a','128k',
          '-video_track_timescale','30000','-g','60','-sc_threshold','0',
          padded
        ]
      : [
          '-y',
          '-i', OUTPUT,
          '-f','lavfi','-t', String(END_PAD_SEC), '-i', color,
          '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map','[v]',
          '-c:v','libx264','-r','30','-pix_fmt','yuv420p',
          '-video_track_timescale','30000','-g','60','-sc_threshold','0',
          padded
        ];

    await run('ffmpeg', padArgs);
    await fs.rename(padded, OUTPUT);
    console.log(`🧷 end padded: +${END_PAD_SEC}s (black${hadAudio ? ' + silence' : ''})`);
  }
})().catch(e => {
  console.error('❌ generate_body failed:', e);
  process.exit(1);
});
