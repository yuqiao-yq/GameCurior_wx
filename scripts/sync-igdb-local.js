#!/usr/bin/env node
// scripts/sync-igdb-local.js
//
// 本地拉 IGDB → 输出 JSON 文件，然后用 cloudbase CLI 把 JSON 喂给云函数 syncFromIGDB
//
// 为什么这么做：
//   - 腾讯云函数出口到 id.twitch.tv / api.igdb.com (AWS) 不可达 → 云函数自己拉 IGDB 会 timeout
//   - GitHub Actions 调云数据库需要腾讯云 CAM 关联（个人小程序卡死）或 AppSecret IP 白名单（runner 动态 IP 卡死）
//   - 唯一可行：本地脚本拉 IGDB（你本地能通）→ 输出 JSON → cloudbase CLI invoke 云函数（管理员微信扫码授权）
//
// 必需环境变量：
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//
// 可选环境变量：
//   IGDB_TOKEN_CACHE_FILE  本地 token 缓存路径（默认 ./.igdb-token.json，gitignore 排除）
//
// 可选 CLI 参数：
//   --platforms=130,167,48,169,49   IGDB 平台 ID（默认 5 大主机）
//   --limit=30                      每平台拉取数量（默认 30）
//   --out=./.igdb-batch.json        输出 JSON 路径
//
// 平台 ID：Switch=130 / PS5=167 / PS4=48 / Xbox Series=169 / Xbox One=49 / PC=6
//
// 全流程：
//   1. node scripts/sync-igdb-local.js --platforms=130 --limit=3
//      → 产出 scripts/.igdb-batch.json
//   2. cd /Users/zhuyuqiao/Documents/code/GameCurior_wx
//      cloudbase functions:invoke syncFromIGDB \
//        --params "$(cat scripts/.igdb-batch.json)" \
//        -e cloud1-8g8jrsgc94538121
//   3. 看返回 { inserted: N, updated: M, failed: 0 } 即成功

const https = require('https');
const fs = require('fs');
const path = require('path');

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET } = process.env;

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
  console.error('❌ 缺少环境变量 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET');
  console.error('   申请：https://dev.twitch.tv/console/apps');
  process.exit(1);
}

const argv = process.argv.slice(2).reduce((acc, s) => {
  const m = s.match(/^--([^=]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const PLATFORMS = (argv.platforms || '130,167,48,169,49')
  .split(',').map((s) => Number(s.trim())).filter(Boolean);
const LIMIT_PER_PLATFORM = Number(argv.limit) || 30;
const OUT_PATH = argv.out || path.join(__dirname, '.igdb-batch.json');
const TOKEN_CACHE_PATH = process.env.IGDB_TOKEN_CACHE_FILE
  || path.join(__dirname, '.igdb-token.json');

// ============ HTTP ============
function httpRequest(method, url, body, headers, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      timeout,
      headers: {
        'User-Agent': 'GameCurior-Sync/1.0',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

const httpPost = (url, body, headers) => httpRequest('POST', url, body, headers);

// ============ Twitch token（本地文件缓存） ============
async function getAccessToken() {
  // 读本地缓存
  if (fs.existsSync(TOKEN_CACHE_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
      if (cached.value && cached.expiresAt && new Date(cached.expiresAt).getTime() > Date.now() + 3600 * 1000) {
        console.log(`[token] 本地缓存命中（过期于 ${cached.expiresAt}）`);
        return cached.value;
      }
    } catch (e) { /* fall through */ }
  }

  console.log('[token] 请求 Twitch 新 token...');
  const url = `https://id.twitch.tv/oauth2/token`
    + `?client_id=${TWITCH_CLIENT_ID}`
    + `&client_secret=${TWITCH_CLIENT_SECRET}`
    + `&grant_type=client_credentials`;
  const resp = await httpPost(url, '', { 'Content-Type': 'application/x-www-form-urlencoded' });
  if (!resp.access_token) throw new Error('Twitch 未返回 access_token');

  const expiresAt = new Date(Date.now() + (resp.expires_in || 0) * 1000).toISOString();
  fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
    value: resp.access_token,
    expiresAt,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`[token] 已缓存到 ${TOKEN_CACHE_PATH}（过期于 ${expiresAt}）`);
  return resp.access_token;
}

// ============ IGDB API ============
async function fetchByPlatform(platformId, accessToken, limit) {
  const body = `fields name,summary,cover.url,screenshots.url,platforms.name,platforms.id,`
    + `genres.name,themes.name,first_release_date,rating,aggregated_rating,total_rating_count,`
    + `involved_companies.company.name,involved_companies.developer,involved_companies.publisher,`
    + `external_games.uid,external_games.category;`
    + `where platforms = (${platformId}) & rating != null & total_rating_count > 10;`
    + `sort total_rating_count desc;`
    + `limit ${limit};`;

  return await httpPost('https://api.igdb.com/v4/games', body, {
    'Client-ID': TWITCH_CLIENT_ID,
    'Authorization': `Bearer ${accessToken}`,
    'Accept': 'application/json',
    'Content-Type': 'text/plain',
  });
}

// ============ 主流程 ============
async function main() {
  console.log(`[sync-igdb-local] platforms=${PLATFORMS.join(',')} limit=${LIMIT_PER_PLATFORM}`);

  const accessToken = await getAccessToken();

  const allGames = [];
  const seenIds = new Set(); // 跨平台去重（多平台游戏会重复出现）

  for (const platformId of PLATFORMS) {
    process.stdout.write(`[platform ${platformId}] 拉取... `);
    try {
      const list = await fetchByPlatform(platformId, accessToken, LIMIT_PER_PLATFORM);
      const fresh = (list || []).filter((g) => {
        if (seenIds.has(g.id)) return false;
        seenIds.add(g.id);
        return true;
      });
      allGames.push(...fresh);
      console.log(`拿到 ${list.length} 条（去重新增 ${fresh.length}）`);
    } catch (e) {
      console.log(`失败: ${e.message}`);
    }
    // IGDB 限速 4 req/s
    await new Promise((r) => setTimeout(r, 300));
  }

  if (allGames.length === 0) {
    console.error('\n❌ 没拉到任何数据，不写出 JSON');
    process.exit(1);
  }

  // 写出 JSON（格式直接对应云函数 event 参数）
  const payload = { mode: 'batch', games: allGames };
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload));

  console.log(`\n✅ 共 ${allGames.length} 条游戏数据，已写入 ${OUT_PATH}`);
  console.log(`\n🚀 下一步：调云函数入库\n`);
  console.log(`   cloudbase functions:invoke syncFromIGDB \\`);
  console.log(`     --params "$(cat ${path.relative(process.cwd(), OUT_PATH)})" \\`);
  console.log(`     -e <你的环境 ID>`);
  console.log(`\n   或者一键管道：`);
  console.log(`   cloudbase functions:invoke syncFromIGDB --params "$(cat ${path.relative(process.cwd(), OUT_PATH)})"`);
  console.log(`\n   首次使用需要先：cloudbase login（微信扫码）`);
}

main().catch((err) => {
  console.error('\n❌ fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
