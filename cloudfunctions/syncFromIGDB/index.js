// cloudfunctions/syncFromIGDB/index.js
// 从 IGDB (Twitch 旗下) 同步主机平台 + 冷门 / 日韩独占游戏数据
//
// 认证：Twitch app credentials（client_id + client_secret）→ 自动换 access_token
// 申请：https://dev.twitch.tv/console/apps （5 分钟）
// 环境变量：在云开发控制台 → 云函数 → syncFromIGDB → 环境变量 配置
//   TWITCH_CLIENT_ID
//   TWITCH_CLIENT_SECRET
//
// API 文档：https://api-docs.igdb.com/
// 平台 ID：Switch=130 / PS5=167 / PS4=48 / Xbox Series=169 / Xbox One=49 / PC=6
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const gamesCol = db.collection('games');
const cacheCol = db.collection('kvCache');

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';

// IGDB 平台 ID → 内部 platforms 枚举（与 RAWG / SteamStore 对齐）
const IGDB_PLATFORM_MAP = {
  6: 'pc',
  14: 'mac',
  3: 'linux',
  48: 'ps4',
  167: 'ps5',
  49: 'xbox1',
  169: 'xboxs',
  130: 'switch',
  34: 'android',
  39: 'ios',
};

// IGDB external_games.category：1=Steam，其余暂不映射
const EXT_CATEGORY_STEAM = 1;

// ============ HTTP GET（用于 Twitch oauth） ============
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'GameCurior/1.0' } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
  });
}

// ============ HTTP POST（IGDB 用 text/plain Apicalypse body） ============
function httpPost(url, body, headers = {}, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + u.search,
      timeout,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'GameCurior/1.0',
        ...headers,
      },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${buf.slice(0, 200)}`));
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    req.write(data);
    req.end();
  });
}

// ============ Twitch token 管理（带云数据库缓存） ============
// Twitch app access token 有效期 ~60 天；存在 kvCache 集合，过期前 1h 触发刷新
async function getAccessToken() {
  // 1. 先读缓存
  try {
    const cached = await cacheCol.doc('igdb_token').get();
    const { value, expiresAt } = cached.data || {};
    if (value && expiresAt && new Date(expiresAt).getTime() > Date.now() + 3600 * 1000) {
      return value;
    }
  } catch (e) {
    // 文档不存在（首次运行）→ 走下面申请流程
  }

  // 2. 申请新 token
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    throw new Error('未配置 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET 环境变量');
  }
  const url = `https://id.twitch.tv/oauth2/token`
    + `?client_id=${TWITCH_CLIENT_ID}`
    + `&client_secret=${TWITCH_CLIENT_SECRET}`
    + `&grant_type=client_credentials`;
  // Twitch oauth2/token 必须 POST，body 可为空
  const resp = await httpPost(url, '', { 'Content-Type': 'application/x-www-form-urlencoded' });
  const { access_token, expires_in } = resp || {};
  if (!access_token) throw new Error('Twitch oauth 未返回 access_token');

  const expiresAt = new Date(Date.now() + (expires_in || 0) * 1000);

  // 3. 写回缓存（doc 不存在用 add，存在用 set/update）
  try {
    await cacheCol.doc('igdb_token').set({
      data: { value: access_token, expiresAt, updatedAt: new Date() },
    });
  } catch (e) {
    // set 在 doc 不存在时可能报错，尝试 add
    try {
      await cacheCol.add({ data: { _id: 'igdb_token', value: access_token, expiresAt, updatedAt: new Date() } });
    } catch (e2) {
      console.warn('[IGDB] 写 token 缓存失败（不影响本次调用）:', e2.message);
    }
  }

  return access_token;
}

// ============ 调 IGDB /games 端点 ============
async function fetchByPlatform(platformId, accessToken, limit = 30) {
  // Apicalypse 文本语法：每个 clause 以 ; 结尾
  // total_rating_count > 10 过滤掉无评分的占位条目
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
  });
}

// ============ 工具：把 IGDB 协议相对 URL 补成 https + 替尺寸 ============
function igdbImage(url, size) {
  if (!url) return '';
  // url 形如 //images.igdb.com/igdb/image/upload/t_thumb/co1rba.jpg
  const full = url.startsWith('http') ? url : `https:${url}`;
  return full.replace('/t_thumb/', `/t_${size}/`);
}

// ============ 标准化 IGDB 数据 ============
function normalize(raw) {
  // platforms
  const platforms = Array.from(new Set(
    (raw.platforms || [])
      .map((p) => IGDB_PLATFORM_MAP[p.id])
      .filter(Boolean)
  ));

  // 从 external_games 反查 Steam appid（用作跨源去重锚）
  const steamExt = (raw.external_games || []).find((e) => e.category === EXT_CATEGORY_STEAM);
  const steamId = steamExt && steamExt.uid ? String(steamExt.uid) : null;

  // companies → developer / publisher（取第一个）
  const developers = (raw.involved_companies || [])
    .filter((c) => c.developer && c.company && c.company.name)
    .map((c) => c.company.name);
  const publishers = (raw.involved_companies || [])
    .filter((c) => c.publisher && c.company && c.company.name)
    .map((c) => c.company.name);

  // tags = genres + themes，截断 12 字符，最多 10 个
  const tagPool = []
    .concat((raw.genres || []).map((g) => g.name))
    .concat((raw.themes || []).map((t) => t.name))
    .filter((n) => n && n.length <= 12);
  const tags = Array.from(new Set(tagPool)).slice(0, 10);

  // rating：IGDB 是 0-100 制，对齐本仓 0-10
  // aggregated_rating（媒体）优先于 rating（用户）
  const rawRating = raw.aggregated_rating || raw.rating || 0;
  const rating = rawRating ? Number((rawRating / 10).toFixed(1)) : 0;

  // releasedAt：unix 秒 → 'YYYY-MM-DD'
  let releasedAt = null;
  if (raw.first_release_date) {
    const d = new Date(raw.first_release_date * 1000);
    if (!isNaN(d.getTime())) releasedAt = d.toISOString().slice(0, 10);
  }

  // 截图：取 t_screenshot_huge（1280x720），最多 6 张
  const screenshots = (raw.screenshots || [])
    .slice(0, 6)
    .map((s) => igdbImage(s.url, 'screenshot_huge'))
    .filter(Boolean);

  // 封面：t_cover_big (227x320)
  const cover = raw.cover && raw.cover.url ? igdbImage(raw.cover.url, 'cover_big') : '';

  return {
    externalIds: {
      igdb: String(raw.id),
      ...(steamId ? { steam: steamId } : {}),
    },
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
    storeUrls: {}, // IGDB 不给商店链接，避免覆盖已有
    videos: [],    // IGDB 视频字段是 game_videos.video_id（YouTube），暂不接入
  };
}

// ============ 智能 Upsert ============
// 字段优先级：IGDB > RAWG > Steam > Seed（中文名 seed 不被覆盖）
// 价格相关字段不写：IGDB 不提供价格，避免误清空 CheapShark 写入的值
async function upsertGame(data) {
  const now = new Date();
  const steamId = data.externalIds.steam;
  const igdbId = data.externalIds.igdb;

  // 去重锚：steam 优先，igdb 兜底（让能跨源匹配 SteamStore 已入库的同一款游戏）
  const where = steamId ? { 'externalIds.steam': steamId } : { 'externalIds.igdb': igdbId };
  const { data: existing } = await gamesCol.where(where).limit(1).get();

  if (existing.length === 0) {
    await gamesCol.add({
      data: {
        ...data,
        price: 0,
        originalPrice: 0,
        discount: 0,
        isFree: false,
        categoryId: '',
        stats: { favCount: 0, viewCount: 0, steamOwners: 0, steamPositiveRate: 0 },
        dataSources: ['igdb'],
        status: 1,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { igdb: now },
      },
    });
    return 'inserted';
  }

  const old = existing[0];
  const hasSeed = (old.dataSources || []).includes('seed');

  // 合并：保留中文名 / 中文描述；截图视频画质优先 IGDB；价格不动
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

  await gamesCol.doc(old._id).update({ data: merged });
  return 'updated';
}

// ============ 主入口 ============
// event 参数：
//   - platforms: number[] 多个 IGDB 平台 ID（默认 5 大主机：Switch/PS5/PS4/XboxS/Xbox1）
//   - limitPerPlatform: 每个平台拉取数量（默认 30）
exports.main = async (event, context) => {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    return {
      code: 1001,
      message: '未配置 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET 环境变量，请到 https://dev.twitch.tv/console/apps 申请后在云开发控制台配置',
      data: null,
    };
  }

  const platforms = Array.isArray(event.platforms) && event.platforms.length > 0
    ? event.platforms
    : [130, 167, 48, 169, 49]; // Switch / PS5 / PS4 / XboxS / Xbox1
  const limitPerPlatform = event.limitPerPlatform || 30;

  try {
    const accessToken = await getAccessToken();
    console.log('[IGDB] token ready, scanning platforms:', platforms.join(','));

    const stats = {
      total: 0, inserted: 0, updated: 0, failed: 0,
      perPlatform: {},
      failures: [],
    };

    for (const platformId of platforms) {
      const p = { total: 0, inserted: 0, updated: 0, failed: 0 };
      try {
        const list = await fetchByPlatform(platformId, accessToken, limitPerPlatform);
        p.total = (list || []).length;
        stats.total += p.total;

        for (const item of list || []) {
          try {
            const normalized = normalize(item);
            const result = await upsertGame(normalized);
            p[result]++;
            stats[result]++;
          } catch (e) {
            p.failed++;
            stats.failed++;
            stats.failures.push({ platformId, name: item.name, error: e.message });
          }
        }
      } catch (e) {
        console.warn(`[IGDB] platform=${platformId} fetch fail:`, e.message);
        stats.failures.push({ platformId, error: e.message });
      }
      stats.perPlatform[platformId] = p;
      // IGDB 限速 4 req/s，平台间留 300ms 间隔
      await new Promise((r) => setTimeout(r, 300));
    }

    return { code: 0, message: 'ok', data: { source: 'igdb', ...stats } };
  } catch (err) {
    console.error('[IGDB] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
