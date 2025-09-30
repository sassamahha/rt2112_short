// scripts/youtube_upload.js
// env: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN
//      VIDEO_TITLE / VIDEO_DESC / FINAL_MP4 / PRIVACY_STATUS
//      TAGS (comma) / PUBLISH_AT (RFC3339; e.g. 2025-10-16T01:00:00Z)
import axios from 'axios';
import fs from 'fs';

const {
  YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN,
  VIDEO_TITLE = 'Rt2112 — Short',
  VIDEO_DESC  = '#RoadTo2112 #ShortStory #SciFi',
  FINAL_MP4   = 'final.mp4',
  PRIVACY_STATUS = 'public',
  TAGS = '',
  PUBLISH_AT, // optional RFC3339; if set, privacy must be 'private'
} = process.env;

if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error('Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN');
  process.exit(1);
}

const MAX_RETRY = 5;

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function isDailyLimitError(err) {
  const s = err?.response?.status;
  const msg = JSON.stringify(err?.response?.data || {});
  return s === 400 && /exceeded the number of videos/i.test(msg);
}

function isRetryable(err) {
  const s = err?.response?.status;
  const reason = err?.response?.data?.error?.errors?.[0]?.reason;
  // 5xx / 429 / 一部の 403 はリトライ
  if (s >= 500) return true;
  if (s === 429) return true;
  if (s === 403 && /rateLimitExceeded|quotaExceeded|backendError/i.test(reason || '')) return true;
  return false;
}

async function token() {
  const body = new URLSearchParams({
    client_id: YT_CLIENT_ID,
    client_secret: YT_CLIENT_SECRET,
    refresh_token: YT_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const r = await axios.post('https://oauth2.googleapis.com/token', body.toString(),
    { headers:{'Content-Type':'application/x-www-form-urlencoded'} });
  return r.data.access_token;
}

async function uploadOnce() {
  const access = await token();

  // publishAt が指定されたら YouTube の仕様に合わせて private 強制
  let privacy = PRIVACY_STATUS;
  const status = { privacyStatus: privacy };
  if (PUBLISH_AT) {
    if (privacy !== 'private') {
      console.log(`[NOTE] PUBLISH_AT is set -> forcing privacy=private`);
      privacy = 'private';
    }
    status.privacyStatus = 'private';
    status.publishAt = PUBLISH_AT;
  }

  const snippet = {
    title: VIDEO_TITLE.slice(0,95),
    description: VIDEO_DESC,
    categoryId: '1',
  };
  const tags = TAGS.split(',').map(s=>s.trim()).filter(Boolean);
  if (tags.length) snippet.tags = tags;

  // 1) init resumable
  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    { snippet, status },
    { headers: { Authorization: `Bearer ${access}`, 'Content-Type':'application/json' } }
  );
  const location = init.headers.location;
  if (!location) throw new Error('No resumable upload location header');

  // 2) upload binary (stream to avoid buffering whole file)
  await axios.put(location, fs.createReadStream(FINAL_MP4), {
    headers: { Authorization: `Bearer ${access}`, 'Content-Type':'video/*' },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });

  console.log('✅ uploaded:', FINAL_MP4);
}

async function main() {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      await uploadOnce();
      return;
    } catch (e) {
      if (isDailyLimitError(e)) {
        console.log('🟡 Daily upload limit hit. Stop gracefully; resume next run.');
        console.log(JSON.stringify(e.response?.data || {}, null, 2));
        process.exit(0); // 成功扱いで終了（次のスケジュールに任せる）
      }
      if (isRetryable(e) && attempt < MAX_RETRY) {
        const backoff = Math.min(60000, 2000 * attempt ** 2);
        console.warn(`Retryable error (attempt ${attempt}/${MAX_RETRY}) → wait ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      console.error('❌ Upload failed:', e.response?.data || e);
      process.exit(1);
    }
  }
}

main();
