#!/usr/bin/env node
// scripts/sync-igdb-ci.js
//
// 在 GitHub Actions（或本地）跑的 IGDB 同步脚本：从 IGDB 拉主机平台热门游戏，
// 用 @cloudbase/node-sdk 直接写微信云开发数据库。
//
// 为什么不放云函数：腾讯云函数出口到 id.twitch.tv (AWS) 不可达，
// 但 GitHub Actions runner 出口在海外、本地代理也通，所以同步逻辑在外部跑。
//
// 必需环境变量：
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//   CLOUDBASE_SECRET_ID      腾讯云 CAM 子账号 secretId
//   CLOUDBASE_SECRET_KEY     腾讯云 CAM 子账号 secretKey
//   CLOUD_ENV_ID             云开发环境 ID（如 cloud1-xxxxxxx）
//
// 可选 CLI 参数：
//   --platforms=130,167,48,169,49   IGDB 平台 ID（默认 5 大主机）
//   --limit=30                      每平台拉取数量（默认 30）
//
// 平台 ID：Switch=130 / PS5=167 / PS4=48 / Xbox Series=169 / Xbox One=49 / PC=6

const https = require('https');
const tcb = require('@cloudbase/node-sdk');

// ============ 配置 ============
const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  CLOUDBASE_SECRET_ID,
  CLOUDBASE_SECRET_KEY,
  CLOUD_ENV_ID,
} = process.env;

for (const [k, v] of Object.entries({
  TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET,
  CLOUDBASE_SECRET_ID, CLOUDBASE_SECRET_KEY, CLOUD_ENV_ID,
})) {
  if (!v) {
    console.error(`[sync-igdb] 缺少环境变量: ${k}`);
    process.exit(1);
  }
}

// CLI 参数：--platforms=130,167 --limit=30
const argv = process.argv.slice(2).reduce((acc, s) => {
  const m = s.match(/^--([^=]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const PLATFORMS = (argv.platforms || '130,167,48,169,49').split(',').map((s) => Number(s.trim())).filter(Boolean);
const LIMIT_PER_PLATFORM = Number(argv.limit) || 30;

// ============ IGDB 平台 ID → 内部 platforms 枚举 ============
const IGDB_PLATFORM_MAP = {
  6: 'pc', 14: 'mac', 3: 'linux',
  48: 'ps4', 167: 'ps5',
  49: 'xbox1', 169: 'xboxs',
  130: 'switch',
  34: 'android', 39: 'ios',
};
const EXT_CATEGORY_STEAM = 1;

// ============ CloudBase SDK 初始化 ============
const app = tcb.init({
  env: CLOUD_ENV_ID,
  secretId: CLOUDBASE_SECRET_ID,
  secretKey: CLOUDBASE_SECRET_KEY,
});
const db = app.database();
const gamesCol = db.collection('games');
const cacheCol = db.collection('kvCache');

// ============ HTTP 工具 ============
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

const httpGet = (url, timeout) => httpRequest('GET', url, null, {}, timeout);
const httpPost = (url, body, headers, timeout) => httpRequest('POST', url, body, headers, timeout);

// ============ Twitch token 管理（云数据库缓存） ============
async function getAccessToken() {
  // 1. 读缓存
  try {
    const cached = await cacheCol.doc('igdb_token').get();
    const doc = (cached.data && cached.data[0]) || cached.data || {};
    const value = doc.value;
    const expiresAt = doc.expiresAt && (doc.expiresAt.$date || doc.expiresAt);
    if (value && expiresAt && new Date(expiresAt).getTime() > Date.now() + 3600 * 1000) {
      console.log('[token] cache hit, expiresAt =', new Date(expiresAt).toISOString());
      return value;
    }
  } catch (e) {
    // 文档不存在或集合不存在 → 走申请流程
  }

  // 2. 申请新 token
  console.log('[token] requesting new from Twitch...');
  const url = `https://id.twitch.tv/oauth2/token`
    + `?client_id=${TWITCH_CLIENT_ID}`
    + `&client_secret=${TWITCH_CLIENT_SECRET}`
    + `&grant_type=client_credentials`;
  const resp = await httpPost(url, '', { 'Content-Type': 'application/x-www-form-urlencoded' });
  const { access_token, expires_in } = resp || {};
  if (!access_token) throw new Error('Twitch oauth 未返回 access_token');

  const expiresAt = new Date(Date.now() + (expires_in || 0) * 1000);
  console.log('[token] new token, expires in', Math.round((expires_in || 0) / 86400), 'days');

  // 3. 写缓存（doc 不存在用 set，会自动创建）
  try {
    await cacheCol.doc('igdb_token').set({
      value: access_token,
      expiresAt,
      updatedAt: new Date(),
    });
  } catch (e) {
    console.warn('[token] 写缓存失败（不影响本次）:', e.message);
  }

  return access_token;
}

// ============ IGDB API 调用 ============
async function fetchByPlatform(platformId, accessToken, limit = 30) {
  const body = `fields name,summary,cover.url,screenshots.url,platforms.name,`
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

// ============ 数据标准化 ============
function igdbImage(url, size) {
  if (!url) return '';
  const full = url.startsWith('http') ? url : `https:${url}`;
  return full.replace('/t_thumb/', `/t_${size}/`);
}

function normalize(raw) {
  const platforms = Array.from(new Set(
    (raw.platforms || []).map((p) => IGDB_PLATFORM_MAP[p.id]).filter(Boolean)
  ));

  const steamExt = (raw.external_games || []).find((e) => e.category === EXT_CATEGORY_STEAM);
  const steamId = steamExt && steamExt.uid ? String(steamExt.uid) : null;

  const developers = (raw.involved_companies || [])
    .filter((c) => c.developer && c.company && c.company.name)
    .map((c) => c.company.name);
  const publishers = (raw.involved_companies || [])
    .filter((c) => c.publisher && c.company && c.company.name)
    .map((c) => c.company.name);

  const tagPool = []
    .concat((raw.genres || []).map((g) => g.name))
    .concat((raw.themes || []).map((t) => t.name))
    .filter((n) => n && n.length <= 12);
  const tags = Array.from(new Set(tagPool)).slice(0, 10);

  const rawRating = raw.aggregated_rating || raw.rating || 0;
  const rating = rawRating ? Number((rawRating / 10).toFixed(1)) : 0;

  let releasedAt = null;
  if (raw.first_release_date) {
    const d = new Date(raw.first_release_date * 1000);
    if (!isNaN(d.getTime())) releasedAt = d.toISOString().slice(0, 10);
  }

  const screenshots = (raw.screenshots || []).slice(0, 6)
    .map((s) => igdbImage(s.url, 'screenshot_huge')).filter(Boolean);
  const cover = raw.cover && raw.cover.url ? igdbImage(raw.cover.url, 'cover_big') : '';

  return {
    externalIds: { igdb: String(raw.id), ...(steamId ? { steam: steamId } : {}) },
    name: raw.name || '',
    nameEn: raw.name || '',
    description: raw.summary ? String(raw.summary).slice(0, 800) : '',
    cover,
    headerImage: cover,
    screenshots,
    rating,
    ratingCount: raw.total_rating_count || 0,
    tags,
    platforms,
    developer: developers[0] || '',
    publisher: publishers[0] || '',
    releasedAt,
    storeUrls: {},
    videos: [],
  };
}

// ============ Upsert ============
async function upsertGame(data) {
  const now = new Date();
  const steamId = data.externalIds.steam;
  const igdbId = data.externalIds.igdb;

  const where = steamId ? { 'externalIds.steam': steamId } : { 'externalIds.igdb': igdbId };
  const { data: existing } = await gamesCol.where(where).limit(1).get();

  if (existing.length === 0) {
    await gamesCol.add({
      ...data,
      price: 0, originalPrice: 0, discount: 0, isFree: false,
      categoryId: '',
      stats: { favCount: 0, viewCount: 0, steamOwners: 0, steamPositiveRate: 0 },
      dataSources: ['igdb'],
      status: 1,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: { igdb: now },
    });
    return 'inserted';
  }

  const old = existing[0];
  const hasSeed = (old.dataSources || []).includes('seed');

  const merged = {
    name: hasSeed ? old.name : (old.name || data.name),
    nameEn: data.nameEn || old.nameEn,
    description: hasSeed && old.description ? old.description : (old.description || data.description),
    cover: old.cover || data.cover,
    headerImage: old.headerImage || data.headerImage,
    screenshots: data.screenshots.length > 0 ? data.screenshots : (old.screenshots || []),
    videos: old.videos || [],
    tags: Array.from(new Set([...(old.tags || []), ...data.tags])),
    platforms: Array.from(new Set([...(old.platforms || []), ...data.platforms])),
    developer: old.developer || data.developer,
    publisher: old.publisher || data.publisher,
    releasedAt: old.releasedAt || data.releasedAt,
    rating: Math.max(old.rating || 0, data.rating || 0),
    ratingCount: Math.max(old.ratingCount || 0, data.ratingCount),
    storeUrls: { ...(data.storeUrls || {}), ...(old.storeUrls || {}) },
    'externalIds.igdb': igdbId,
    dataSources: Array.from(new Set([...(old.dataSources || []), 'igdb'])),
    status: 1,
    updatedAt: now,
    'lastSyncedAt.igdb': now,
  };

  await gamesCol.doc(old._id).update(merged);
  return 'updated';
}

// ============ 主流程 ============
async function main() {
  console.log('[sync-igdb] platforms=', PLATFORMS.join(','), 'limit=', LIMIT_PER_PLATFORM);
  console.log('[sync-igdb] env=', CLOUD_ENV_ID);

  const accessToken = await getAccessToken();

  const stats = {
    total: 0, inserted: 0, updated: 0, failed: 0,
    perPlatform: {},
    failures: [],
  };

  for (const platformId of PLATFORMS) {
    const p = { total: 0, inserted: 0, updated: 0, failed: 0 };
    try {
      console.log(`\n[platform ${platformId}] fetching...`);
      const list = await fetchByPlatform(platformId, accessToken, LIMIT_PER_PLATFORM);
      p.total = (list || []).length;
      stats.total += p.total;
      console.log(`[platform ${platformId}] got ${p.total} games, upserting...`);

      for (const item of list || []) {
        try {
          const normalized = normalize(item);
          const result = await upsertGame(normalized);
          p[result]++;
          stats[result]++;
          process.stdout.write(result === 'inserted' ? '+' : '·');
        } catch (e) {
          p.failed++;
          stats.failed++;
          stats.failures.push({ platformId, name: item.name, error: e.message });
          process.stdout.write('x');
        }
      }
      console.log(`\n[platform ${platformId}] done: +${p.inserted} ·${p.updated} x${p.failed}`);
    } catch (e) {
      console.error(`[platform ${platformId}] fetch fail:`, e.message);
      stats.failures.push({ platformId, error: e.message });
    }
    stats.perPlatform[platformId] = p;
    // IGDB 限速 4 req/s
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n========== SUMMARY ==========');
  console.log(JSON.stringify(stats, null, 2));

  if (stats.failed > 0) {
    console.error(`\n⚠️  ${stats.failed} failures`);
  }
}

main().then(() => {
  console.log('\n✅ sync-igdb done');
  process.exit(0);
}).catch((err) => {
  console.error('\n❌ sync-igdb fatal:', err.message);
  console.error(err.stack);
  process.exit(1);
});
