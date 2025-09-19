// scripts/generate_body.js

import { execFile, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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

// 表示
const ALWAYS_ON_COPY = process.env.ALWAYS_ON_COPY === '1';
const HEADLINE_SECS  = Number(process.env.HEADLINE_SECS || 3);
const REAPPEAR_AT    = Number(process.env.REAPPEAR_AT || 11);
const TAIL_OFF_SEC   = Number(process.env.TAIL_OFF_SEC || 0.8);

// レイアウト
const FIT_MODE  = (process.env.FIT_MODE || 'cover').toLowerCase(); // 'cover'|'contain'
const INSET_PCT = Number(process.env.INSET_PCT || 1.0);
const TAG_POS   = (process.env.TAG_POS || 'center').toLowerCase();

// テキスト/帯
let   FONT_FILE = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_SIZE = Number(process.env.FONT_SIZE || 72);
const MAX_LINES = Number(process.env.MAX_LINES || 2);
const TEXT_MARGIN_PCT = Number(process.env.TEXT_MARGIN_PCT || 0.06);
const TEXT_COLOR = process.env.TEXT_COLOR || 'black';
const TEXT_BORDERW = Number(process.env.TEXT_BORDERW || 2);
const TEXT_BORDERCOLOR = process.env.TEXT_BORDERCOLOR || 'black';
const BAR_COLOR   = process.env.BAR_COLOR || 'white';
const BAR_OPACITY = Number(process.env.BAR_OPACITY ?? 0.35);
const BAR_PAD_PX  = Number(process.env.BAR_PAD_PX || 18);
const COPY_BOX_OPACITY = Number(process.env.COPY_BOX_OPACITY || 0);

// 出力
const OUTPUT  = 'final.mp4';
const TMP_DIR = path.join(__dirname, '..', 'out');
const W = 1080, H = 1920;

const run = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, { stdio: 'inherit' }, e => e ? rej(e) : res()));

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (a) => { for (let i=a.length-1;i>0;i--){const j=(Math.random()* (i+1))|0; [a[i],a[j]]=[a[j],a[i]]} return a; };

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

// --- BGM恒久対策 ----------------------------------------------------------

/** ASCIIにサニタイズしたファイル名で一時コピー */
async function sanitizeCopy(srcAbs) {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const base = path.basename(srcAbs);
  const safeBase = base.replace(/[^A-Za-z0-9_.-]/g, '_');
  const dst = path.join(TMP_DIR, `src_${crypto.randomBytes(4).toString('hex')}_${safeBase}`);
  await fs.copyFile(srcAbs, dst);
  return dst;
}

/** 単一BGMをWAVに正規化（解析強化→mp3明示の二段リトライ） */
async function tryNormalizeOnce(absInput) {
  const inPath = await sanitizeCopy(absInput);
  const outWav = path.join(TMP_DIR, `bgm_${crypto.randomBytes(6).toString('hex')}.wav`);

  // Try 1: 解析強化
  try {
    await run('ffmpeg', [
      '-y','-hide_banner','-loglevel','error',
      '-probesize','100M','-analyzeduration','100M','-fflags','+genpts+discardcorrupt',
      '-ignore_unknown',
      '-i', inPath,
      '-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',
      outWav
    ]);
    return outWav;
  } catch {}

  // Try 2: フォーマット明示（mp3想定）
  try {
    await run('ffmpeg', [
      '-y','-hide_banner','-loglevel','error',
      '-f','mp3','-probesize','100M','-analyzeduration','100M','-fflags','+genpts+discardcorrupt',
      '-ignore_unknown',
      '-i', inPath,
      '-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',
      outWav
    ]);
    return outWav;
  } catch {}

  return null;
}

/** 複数BGMを順に試して、使える1本のWAVを返す。全滅ならnull */
async function pickWorkableBgm(candidates) {
  if (!candidates?.length) return null;
  const tries = shuffle([...candidates]);  // シャッフルして偏り回避
  for (const p of tries) {
    const abs = path.resolve(p);
    const ok = await tryNormalizeOnce(abs);
    if (ok) return ok;
    console.warn('⚠️ BGM変換失敗:', path.basename(abs));
  }
  return null;
}

// -------------------------------------------------------------------------

// テキストの自動改行
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

(async () => {
  await fs.mkdir(TMP_DIR, { recursive: true });

  const vids = await listFiles(VIDEOS_DIR, ['.mp4','.mov','.mkv','.MP4','.MOV']);
  if (!vids.length) throw new Error(`No videos in ${VIDEOS_DIR}`);
  const video = pick(vids);

  const taglines = await readLines(TAGLINES_TXT);
  if (!taglines.length) throw new Error(`No taglines in ${TAGLINES_TXT}`);
  const taglineRaw = pick(taglines);
  const taglineWrapped = wrapCopy(taglineRaw, FONT_SIZE, TEXT_MARGIN_PCT, MAX_LINES);

  const bgmFiles = await listFiles(BGM_DIR, ['.mp3','.wav','.m4a','.MP3','.WAV','.M4A']).catch(() => []);
  const safeBgm = await pickWorkableBgm(bgmFiles);

  // 尺
  const dur = DURATION_SEC ?? (MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR));
  const D   = Math.max(5, Math.min(60, Number(dur.toFixed(2))));

  // タイトル/説明（Actionsへ）
  const TITLE_PREFIX = process.env.TITLE_PREFIX || 'Road to 2112';
  const title = `${TITLE_PREFIX} — ${taglineRaw}`.slice(0, 95);
  const desc  = ['https://hub.sassamahha.me', '', '#RoadTo2112 #ShortStory #SciFi #HumansAndRobots'].join('\n');
  if (process.env.GITHUB_ENV) {
    await fs.appendFile(process.env.GITHUB_ENV,
      `VIDEO_TITLE=${title}\nVIDEO_DESC<<EOF\n${desc}\nEOF\nFINAL_MP4=${path.resolve(OUTPUT)}\n`
    );
  }

  // drawtext用テキスト
  const tagFile = path.join(TMP_DIR, 'tagline.txt');
  await fs.writeFile(tagFile, taglineWrapped, 'utf8');

  // タイミング
  const appear1To  = ALWAYS_ON_COPY ? Math.max(0, D - TAIL_OFF_SEC) : Math.min(HEADLINE_SECS, D);
  const appear2At  = ALWAYS_ON_COPY ? 9999 : Math.min(REAPPEAR_AT, Math.max(0, D - 0.5));
  const appear2End = Math.max(0, D - TAIL_OFF_SEC).toFixed(2);
  const fadeOutSt  = (D - 0.35).toFixed(2);
  const aFadeOut   = (D - 0.5).toFixed(2);

  // フィット
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

  // 帯
  const BAR_H = Math.round(FONT_SIZE + BAR_PAD_PX * 2);
  let yBar;
  if (TAG_POS === 'top') yBar = Math.round(H * 0.12);
  else if (TAG_POS === 'bottom') yBar = Math.round(H * 0.82 - BAR_H);
  else yBar = Math.round((H - BAR_H) / 2);
  const textYExpr = `(${yBar}+(${BAR_H}-text_h)/2)`;

  const textCommon = `fontfile=${FONT_FILE}:textfile=${tagFile}:fontsize=${FONT_SIZE}:fontcolor=${TEXT_COLOR}:borderw=${TEXT_BORDERW}:bordercolor=${TEXT_BORDERCOLOR}` +
    (COPY_BOX_OPACITY > 0 ? `:box=1:boxcolor=black@${COPY_BOX_OPACITY}:boxborderw=18` : '');

  const vFilters = [
    `[0:v]${fitFilters.join(',')}`,
    `fade=t=in:st=0:d=0.35`,
    `fade=t=out:st=${fadeOutSt}:d=0.35`,
    `drawbox=x=0:y=${yBar}:w=${W}:h=${BAR_H}:color=${BAR_COLOR}@${BAR_OPACITY}:t=fill:enable='between(t,0,${appear1To})'`,
    `drawtext=${textCommon}:x=(w-text_w)/2:y=${textYExpr}:enable='between(t,0,${appear1To})'`
  ];
  if (!ALWAYS_ON_COPY) {
    vFilters.push(
      `drawbox=x=0:y=${yBar}:w=${W}:h=${BAR_H}:color=${BAR_COLOR}@${BAR_OPACITY}:t=fill:enable='between(t,${appear2At},${appear2End})'`,
      `drawtext=${textCommon}:x=(w-text_w)/2:y=${textYExpr}:enable='between(t,${appear2At},${appear2End})'`
    );
  }
  const vChain = vFilters.join(',') + `[v]`;

  const hasVidAudio = hasAudioStream(video);
  let aChain = '';
  let mapAudio = [];
  if (safeBgm && MIX_MODE === 'mix' && hasVidAudio) {
    aChain = [
      `[0:a]volume=${VIDEO_VOL}[a0]`,
      `[1:a]volume=${BGM_VOL}[a1]`,
      `[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,afade=t=in:st=0:d=0.5,afade=t=out:st=${aFadeOut}:d=0.5[aout]`
    ].join(';');
    mapAudio = ['-map','[aout]'];
  } else if (safeBgm) {
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

  const args = ['-y', '-i', video];
  if (safeBgm) args.push('-stream_loop','-1','-i', safeBgm);
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
  if (safeBgm) console.log('🎵 bgm:', path.basename(safeBgm), `mode=${MIX_MODE}`);
  else console.log('🔇 bgm: none (all candidates failed)');  // ← これが続くならBGM素材を差し替え推奨
  console.log('📝 tagline:', taglineWrapped.replace(/\n/g,' / '));
})();
