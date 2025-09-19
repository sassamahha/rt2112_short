// env: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN
// 受け取り: VIDEO_TITLE / VIDEO_DESC / FINAL_MP4 / PRIVACY_STATUS
import axios from 'axios';
import fs from 'fs';

const {
  YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN,
  VIDEO_TITLE = 'Rt2112 — Short',
  VIDEO_DESC  = '#RoadTo2112 #ShortStory #SciFi',
  FINAL_MP4   = 'final.mp4',
  PRIVACY_STATUS = 'public'
} = process.env;

if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.error('Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN');
  process.exit(1);
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

async function upload() {
  const access = await token();
  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      snippet: { title: VIDEO_TITLE.slice(0,95), description: VIDEO_DESC, categoryId: '1' },
      status:  { privacyStatus: PRIVACY_STATUS }
    },
    { headers: { Authorization: `Bearer ${access}`, 'Content-Type':'application/json' } }
  );
  const location = init.headers.location;
  const bin = fs.readFileSync(FINAL_MP4);
  await axios.put(location, bin, {
    headers: { Authorization: `Bearer ${access}`, 'Content-Type':'video/*' },
    maxBodyLength: Infinity, maxContentLength: Infinity
  });
  console.log('✅ uploaded:', FINAL_MP4);
}
upload().catch(e => { console.error('❌', e.response?.data || e); process.exit(1); });
