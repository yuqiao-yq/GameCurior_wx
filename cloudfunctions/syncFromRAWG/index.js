// cloudfunctions/syncFromRAWG/index.js
// 从 RAWG.io 同步详细游戏信息
// 注册：https://rawg.io/apidocs 获取免费 API Key（20,000 次/月）
// 在云开发控制台 → 云函数 → 选中本函数 → 环境变量，设置 RAWG_API_KEY
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

const RAWG_API_KEY = process.env.RAWG_API_KEY || '';

// ============ URL 脱敏：仅打印 host + path + 非敏感 query，避免 API key 进日志 ============
function safeUrl(url) {
  try {
    const u = new URL(url);
    // 白名单 query 参数（不含 key / token / secret 等敏感字段）
    const allowed = ['platforms', 'page_size', 'ordering', 'dates', 'search', 'page'];
    const kept = [];
    u.searchParams.forEach((v, k) => { if (allowed.includes(k)) kept.push(`${k}=${v}`); });
    return `${u.origin}${u.pathname}${kept.length ? '?' + kept.join('&') : ''}`;
  } catch (e) {
    return url.split('?')[0]; // 兜底：截掉 query
  }
}

// ============ HTTP GET ============
function httpGet(url, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'GameCurior/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (buf += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(new Error('Invalid JSON: ' + e.message));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('request timeout'));
    });
  });
}

// ============ RAWG 平台 ID → 内部 platforms 映射 ============
const PLATFORM_MAP = {
  4: 'pc',       // PC
  5: 'mac',
  6: 'linux',
  18: 'ps4',
  187: 'ps5',
  1: 'xbox1',
  186: 'xboxs',
  7: 'switch',
  21: 'android',
  3: 'ios',
};

// ============ 标准化 RAWG 数据 ============
function normalize(raw) {
  // RAWG 不直接给 Steam appid，需从 stores 数组里找
  const steamStore = (raw.stores || []).find((s) => s.store && s.store.id === 1);
  const steamId = steamStore && steamStore.url
    ? (steamStore.url.match(/\/app\/(\d+)\//) || [])[1]
    : null;

  const platforms = Array.from(new Set(
    (raw.platforms || [])
      .map((p) => PLATFORM_MAP[p.platform && p.platform.id])
      .filter(Boolean)
  ));

  // 标签：过滤掉太长的、太通用的
  const tags = (raw.tags || [])
    .filter((t) => t.name && t.name.length <= 12)
    .slice(0, 10)
    .map((t) => t.name);

  return {
    externalIds: {
      rawg: String(raw.id),
      ...(steamId ? { steam: steamId } : {}),
    },
    name: raw.name,
    nameEn: raw.name,
    description: raw.description_raw ? raw.description_raw.slice(0, 800) : '',
    cover: raw.background_image || '',
    headerImage: raw.background_image || '',
    screenshots: (raw.short_screenshots || []).slice(0, 6).map((s) => s.image),
    rating: raw.metacritic ? raw.metacritic / 10 : (raw.rating ? raw.rating * 2 : 0),
    ratingCount: raw.ratings_count || 0,
    tags,
    platforms,
    developer: (raw.developers && raw.developers[0] && raw.developers[0].name) || '',
    publisher: (raw.publishers && raw.publishers[0] && raw.publishers[0].name) || '',
    releasedAt: raw.released || null,
    storeUrls: (raw.stores || []).reduce((acc, s) => {
      if (s.store && s.url) {
        const key = s.store.slug || `store_${s.store.id}`;
        acc[key] = s.url;
      }
      return acc;
    }, {}),
    videos: raw.clip ? [{ url: raw.clip.video, cover: raw.clip.preview }] : [],
  };
}

// ============ 智能 Upsert ============
async function upsertGame(data) {
  const now = new Date();
  const steamId = data.externalIds.steam;
  const rawgId = data.externalIds.rawg;

  // 优先用 Steam ID 去重，否则用 RAWG ID
  const where = steamId ? { 'externalIds.steam': steamId } : { 'externalIds.rawg': rawgId };
  const { data: existing } = await gamesCol.where(where).limit(1).get();

  if (existing.length === 0) {
    await gamesCol.add({
      data: {
        ...data,
        price: 0,
        originalPrice: 0,
        discount: 0,
        categoryId: '',
        stats: { favCount: 0, viewCount: 0, steamOwners: 0, steamPositiveRate: 0 },
        dataSources: ['rawg'],
        status: 1,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { rawg: now },
      },
    });
    return 'inserted';
  }

  const old = existing[0];
  const hasSeed = (old.dataSources || []).includes('seed');

  // RAWG 的截图/视频/标签最全，覆盖；中文名不覆盖
  const merged = {
    name: hasSeed ? old.name : data.name,
    nameEn: data.nameEn,
    description: hasSeed && old.description ? old.description : data.description,
    cover: old.cover || data.cover,
    headerImage: data.headerImage || old.headerImage,
    screenshots: data.screenshots.length > 0 ? data.screenshots : old.screenshots,
    videos: data.videos.length > 0 ? data.videos : old.videos,
    tags: Array.from(new Set([...(old.tags || []), ...data.tags])),
    platforms: Array.from(new Set([...(old.platforms || []), ...data.platforms])),
    developer: old.developer || data.developer,
    publisher: old.publisher || data.publisher,
    releasedAt: old.releasedAt || data.releasedAt,
    rating: old.rating || data.rating,
    ratingCount: Math.max(old.ratingCount || 0, data.ratingCount),
    storeUrls: { ...(data.storeUrls || {}), ...(old.storeUrls || {}) },
    'externalIds.rawg': rawgId,
    dataSources: Array.from(new Set([...(old.dataSources || []), 'rawg'])),
    status: 1,
    updatedAt: now,
    'lastSyncedAt.rawg': now,
  };

  await gamesCol.doc(old._id).update({ data: merged });
  return 'updated';
}

// ============ 主入口 ============
// event 参数：
//   - mode: 'list' 拉热门列表 / 'enrich' 补全已有游戏的详细信息
//   - pageSize: 单页数量（默认 20）
//   - ordering: 排序（-rating 评分高优先 / -released 新游优先 / -metacritic）
exports.main = async (event, context) => {
  if (!RAWG_API_KEY) {
    return {
      code: 1001,
      message: '未配置 RAWG_API_KEY 环境变量，请到 rawg.io/apidocs 申请免费 Key 后在云开发控制台配置',
      data: null,
    };
  }

  const { mode = 'list', pageSize = 20, ordering = '-rating' } = event;

  try {
    if (mode === 'list') {
      const url = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&page_size=${pageSize}&ordering=${ordering}`;
      console.log('[RAWG] GET', safeUrl(url));
      const json = await httpGet(url);
      const list = json.results || [];

      const stats = { total: list.length, inserted: 0, updated: 0, failed: 0, failures: [] };
      for (const item of list) {
        try {
          // 列表接口字段不全，需要再请求详情拿描述
          const detail = await httpGet(`https://api.rawg.io/api/games/${item.id}?key=${RAWG_API_KEY}`);
          const merged = { ...item, ...detail };
          const normalized = normalize(merged);
          const result = await upsertGame(normalized);
          stats[result]++;
        } catch (e) {
          stats.failed++;
          stats.failures.push({ name: item.name, error: e.message });
        }
      }

      return { code: 0, message: 'ok', data: { source: 'rawg', mode, ...stats } };
    }

    // ============ mode='platform'：按平台拉榜单 ============
    // 用于补全主机平台（Switch / PS5 / PS4 / Xbox Series / Xbox One）的代表作
    // RAWG 平台 ID：Switch=7、PS5=187、PS4=18、Xbox Series=186、Xbox One=1
    // 排序用 -added（RAWG 用户收藏数）而非 -metacritic：主机新游可能没媒体评分会被漏
    if (mode === 'platform') {
      const { platformId } = event;
      if (!platformId) {
        return { code: 1003, message: 'mode=platform 必须提供 platformId', data: null };
      }
      const today = new Date().toISOString().slice(0, 10);
      const dates = event.dates || `2023-01-01,${today}`;
      const platformOrdering = event.ordering || '-added';

      const url = `https://api.rawg.io/api/games?key=${RAWG_API_KEY}`
        + `&platforms=${platformId}`
        + `&page_size=${pageSize}`
        + `&ordering=${platformOrdering}`
        + `&dates=${dates}`;
      console.log('[RAWG:platform] GET', safeUrl(url));
      const json = await httpGet(url);
      const list = json.results || [];

      const stats = { total: list.length, inserted: 0, updated: 0, failed: 0, failures: [] };
      for (const item of list) {
        try {
          // 列表字段不全，再请求详情拿描述
          const detail = await httpGet(`https://api.rawg.io/api/games/${item.id}?key=${RAWG_API_KEY}`);
          const merged = { ...item, ...detail };
          const normalized = normalize(merged);
          const result = await upsertGame(normalized);
          stats[result]++;
        } catch (e) {
          stats.failed++;
          stats.failures.push({ name: item.name, error: e.message });
        }
      }

      return { code: 0, message: 'ok', data: { source: 'rawg', mode, platformId, ...stats } };
    }

    if (mode === 'enrich') {
      // 补全已有游戏：找出未被 rawg 同步过的，按名字查 RAWG
      const { data: pending } = await gamesCol
        .where({ dataSources: db.command.nin(['rawg']) })
        .limit(pageSize)
        .get();

      const stats = { total: pending.length, inserted: 0, updated: 0, failed: 0, failures: [] };
      for (const game of pending) {
        try {
          const search = await httpGet(
            `https://api.rawg.io/api/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(game.nameEn || game.name)}&page_size=1`
          );
          const hit = search.results && search.results[0];
          if (!hit) continue;
          const detail = await httpGet(`https://api.rawg.io/api/games/${hit.id}?key=${RAWG_API_KEY}`);
          const normalized = normalize({ ...hit, ...detail });
          const result = await upsertGame(normalized);
          stats[result]++;
        } catch (e) {
          stats.failed++;
          stats.failures.push({ name: game.name, error: e.message });
        }
      }

      return { code: 0, message: 'ok', data: { source: 'rawg', mode, ...stats } };
    }

    return { code: 1002, message: `unknown mode: ${mode}`, data: null };
  } catch (err) {
    console.error('[RAWG] fatal:', err);
    return { code: 5000, message: err.message, data: null };
  }
};
