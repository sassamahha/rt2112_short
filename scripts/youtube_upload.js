// Upload final.mp4 to YouTube (ShortsOK)
// Auth: prefer env.YT_ACCESS_TOKEN. Fallback to refresh flow if client creds are present.

import axios from "axios";
import fs from "fs";

const {
  // preferred: already exchanged by workflow
  YT_ACCESS_TOKEN,

  // fallback (optional)
  YT_CLIENT_ID,
  YT_CLIENT_SECRET,
  YT_REFRESH_TOKEN,

  // video meta
  VIDEO_TITLE = "Road to 2112",
  VIDEO_DESC = "",
  PRIVACY = "unlisted",              // public | unlisted | private
  FILE_PATH = "final.mp4",           // path to file
} = process.env;

async function getAccessToken() {
  if (YT_ACCESS_TOKEN) return YT_ACCESS_TOKEN;

  if (YT_CLIENT_ID && YT_CLIENT_SECRET && YT_REFRESH_TOKEN) {
    const resp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        client_id: YT_CLIENT_ID,
        client_secret: YT_CLIENT_SECRET,
        refresh_token: YT_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    return resp.data.access_token;
  }

  throw new Error("Missing YT_ACCESS_TOKEN or (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN)");
}

async function main() {
  const accessToken = await getAccessToken();
  if (!fs.existsSync(FILE_PATH)) {
    throw new Error(`FILE_PATH not found: ${FILE_PATH}`);
  }

  // 1) start resumable session
  const start = await axios.post(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&shorts=true",
    {
      snippet: { title: VIDEO_TITLE, description: VIDEO_DESC },
      status: { privacyStatus: PRIVACY },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const location = start.headers.location;
  if (!location) throw new Error("No resumable upload location");

  // 2) PUT binary
  const bin = fs.readFileSync(FILE_PATH);
  const put = await axios.put(location, bin, {
    headers: { "Content-Type": "video/*" },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const videoId = put.data?.id;
  console.log("✅ Uploaded videoId:", videoId || "(unknown)");
}

main().catch((e) => {
  if (e.response?.data) {
    console.error("YouTube API error:", JSON.stringify(e.response.data, null, 2));
  } else {
    console.error(e.stack || e.message || e);
  }
  process.exit(1);
});
