// scripts/generate_body.js
// 動画(10–25秒ランダム or 任意秒) + キャッチコピー + BGM 合成 → final.mp4
// env:
//   VIDEOS_DIR=assets/videos/en
//   TAGLINES_TXT=data/en/taglines.txt
//   BGM_DIR=assets/bgm/en            # 任意。無ければ無音（共通なら assets/bgm/common を指定）
//   DURATION_SEC=15                  # 任意長。未指定なら MIN_DUR〜MAX_DUR からランダム
//   MIN_DUR=10  MAX_DUR=25
//   MIX_MODE=bgm | mix               # bgm=映像音なし+BGM / mix=映像音+bgmミックス
//   VIDEO_VOL=1.0  BGM_VOL=0.25
//   HEADLINE_SECS=4  REAPPEAR_AT=11
//   FONT_FILE=assets/NotoSansJP-Bold.ttf (英語のみなら未指定でもOK)

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

const FONT_FILE  = process.env.FONT_FILE || '';
const OUTPUT     = 'final.mp4';
const W = 1080, H = 1920;

const run = (cmd, args) => new Promise((res, rej) =>
  execFile(cmd, args, { stdio: 'inherit' }, (e) => e ? rej(e) : res())
);
const esc = (t) => t.replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\\\'")
  .replace(/\[/g,'\\[').replace(/\]/g,'\\]');
const randPick = (a) => a[Math.floor(Math.random() * a.length)];

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
    '-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','csv=s=x:p=0', filepath
  ], { encoding:'utf-8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

(async () => {
  // 素材
  const vids = await listFiles(VIDEOS_DIR, ['.mp4','.mov','.mkv']);
  if (!vids.length) throw new Error(`No videos in ${VIDEOS_DIR}`);
  const video = randPick(vids);

  const tags = await readLines(TAGLINES_TXT);
  if (!tags.length) throw new Error(`No taglines in ${TAGLINES_TXT}`);
  const tagline = randPick(tags);

  const bgmFiles = await listFiles(BGM_DIR, ['.mp3','.wav','.m4a']).catch(()=>[]);
  const bgm = bgmFiles.length ? randPick(bgmFiles) : null;

  const dur = DURATION_SEC ?? (MIN_DUR + Math.random() * (MAX_DUR - MIN_DUR));
  const D = Math.max(5, Math.min(60, Number(dur.toFixed(2)))); // 安全ガード

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

  // フィルタ（映像）
  const fontPart = FONT_FILE ? `fontfile='${path.resolve(FONT_FILE)}':` : '';
  const tag = esc(tagline);

  const vchain = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    `fade=t=in:st=0:d=0.35`,
    `fade=t=out:st=${(D-0.35).toFixed(2)}:d=0.35`,
    `drawtext=${fontPart}text='${tag}':fontsize=72:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,0,${Math.min(HEADLINE_SECS,D)})'`,
    `drawtext=${fontPart}text='${tag}':fontsize=72:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:enable='between(t,${Math.min(REAPPEAR_AT, Math.max(0, D-0.5))},${D})'`,
    `[v]`
  ].join(',');

  const hasVidAudio = hasAudioStream(video);
  const parts = [vchain];

  let mapAudio = [];
  if (bgm && MIX_MODE === 'mix' && hasVidAudio) {
    // ミックス: 映像音 + BGM（BGMループは -stream_loop -1 で入力側が担当）
    parts.push(`[0:a]volume=${VIDEO_VOL}[a0]`);
    parts.push(`[1:a]volume=${BGM_VOL}[a1]`);
    parts.push(`[a0][a1]amix=inputs=2:duration=first:dropout_transition=2,afade=t=in:st=0:d=0.5,afade=t=out:st=${(D-0.5).toFixed(2)}:d=0.5[aout]`);
    mapAudio = ['-map','[aout]'];
  } else if (bgm) {
    // BGMのみ
    parts.push(`[1:a]volume=${BGM_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${(D-0.5).toFixed(2)}:d=0.5[aout]`);
    mapAudio = ['-map','[aout]'];
  } else if (hasVidAudio) {
    // 映像音のみ
    parts.push(`[0:a]volume=${VIDEO_VOL},afade=t=in:st=0:d=0.5,afade=t=out:st=${(D-0.5).toFixed(2)}:d=0.5[aout]`);
    mapAudio = ['-map','[aout]'];
  } else {
    // 無音
    mapAudio = ['-an'];
  }

  const args = ['-y', '-i', video];
  if (bgm) args.push('-stream_loop','-1','-i', bgm); // BGMを無限ループ入力

  args.push(
    '-t', String(D),
    '-filter_complex', parts.join(';'),
    '-map','[v]',
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
