// cloudfunctions/syncFromSteamStore/index.js
// 从 Steam 官方商店 API 拉取游戏详细信息（国内访问 OK，免 Key）
// 文档：https://wiki.teamfortress.com/wiki/User:RJackson/StorefrontAPI
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const gamesCol = db.collection('games');

// ============ HTTP GET ============
function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const options = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    };
    const req = https.get(url, options, (res) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 可重试的错误类型（Steam Store 偶发的网络不稳定）
const RETRIABLE = ['request timeout', 'socket hang up', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'];

function isRetriable(err) {
  if (!err || !err.message) return false;
  return RETRIABLE.some((kw) => err.message.includes(kw));
}

// 带 2 次重试的 GET（涵盖 timeout / socket hang up 等）
async function httpGetWithRetry(url, timeout = 15000, maxRetry = 2) {
  let lastErr;
  for (let i = 0; i <= maxRetry; i++) {
    try {
      return await httpGet(url, timeout);
    } catch (e) {
      lastErr = e;
      if (i < maxRetry && isRetriable(e)) {
        // 截掉 query 避免长 URL 噪声；Steam Store 无 API key 但保持各 sync 函数日志风格一致
        console.warn(`[SteamStore] ${e.message}, retry ${i + 1}/${maxRetry}:`, url.split('?')[0]);
        await sleep(800 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ============ 标准化 Steam Store 数据 ============
function normalize(steamData) {
  const steamId = String(steamData.steam_appid);

  // 价格（Steam 返回的是分，cc=cn 时单位是分人民币）
  const priceInfo = steamData.price_overview || {};
  const isFree = steamData.is_free === true;

  const price = isFree ? 0 : (priceInfo.final ? priceInfo.final / 100 : 0);
  const originalPrice = isFree ? 0 : (priceInfo.initial ? priceInfo.initial / 100 : 0);
  const discount = priceInfo.discount_percent || 0;

  // 截图（Steam 提供 full + thumbnail）
  const screenshots = (steamData.screenshots || [])
    .slice(0, 8)
    .map((s) => s.path_full || s.path_thumbnail);

  // 视频
  const videos = (steamData.movies || []).slice(0, 2).map((m) => ({
    url: (m.mp4 && m.mp4['480']) || (m.webm && m.webm['480']) || '',
    cover: m.thumbnail || '',
    name: m.name || '',
  }));

  // 标签：合并 genres + categories（去重）
  const tags = Array.from(new Set([
    ...(steamData.genres || []).map((g) => g.description),
    ...(steamData.categories || []).slice(0, 5).map((c) => c.description),
  ])).filter(Boolean).slice(0, 10);

  // 平台
  const platforms = [];
  if (steamData.platforms) {
    if (steamData.platforms.windows) platforms.push('pc');
    if (steamData.platforms.mac) platforms.push('mac');
    if (steamData.platforms.linux) platforms.push('linux');
  }
  if (!platforms.includes('steam')) platforms.unshift('steam');

  // 发售日
  let releasedAt = null;
  if (steamData.release_date && !steamData.release_date.coming_soon && steamData.release_date.date) {
    // Steam 的日期格式各种各样："17 Sep, 2020" / "2020-09-17" / "2020 年 9 月 17 日"
    releasedAt = steamData.release_date.date;
  }

  return {
    externalIds: { steam: steamId },
    nameEn: steamData.name, // 仅作为英文名兜底
    description: steamData.short_description || '',
    detailedDescription: steamData.detailed_description || '', // HTML 富文本
    cover: `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/library_600x900.jpg`,
    headerImage: steamData.header_image || `https://cdn.akamai.steamstatic.com/steam/apps/${steamId}/header.jpg`,
    screenshots,
    videos,
    price,
    originalPrice,
    discount,
    isFree,
    tags,
    platforms,
    developer: (steamData.developers && steamData.developers[0]) || '',
    publisher: (steamData.publishers && steamData.publishers[0]) || '',
    releasedAt,
    storeUrls: {
      steam: `https://store.steampowered.com/app/${steamId}/`,
    },
    supportedLanguages: steamData.supported_languages || '',
    metacritic: (steamData.metacritic && steamData.metacritic.score) || 0,
  };
}

// ============ 智能 Upsert（智能合并，不覆盖 seed 中文字段）============
async function upsertGame(data) {
  const now = new Date();
  const steamId = data.externalIds.steam;

  const { data: existing } = await gamesCol
    .where({ 'externalIds.steam': steamId })
    .limit(1)
    .get();

  if (existing.length === 0) {
    // 新增
    await gamesCol.add({
      data: {
        ...data,
        name: data.nameEn,         // 没中文名时用英文
        rating: data.metacritic ? data.metacritic / 10 : 0,
        ratingCount: 0,
        categoryId: '',
        stats: { favCount: 0, viewCount: 0 },
        dataSources: ['steamstore'],
        status: 1,
        createdAt: now,
        updatedAt: now,
        lastSyncedAt: { steamstore: now },
      },
    });
    return 'inserted';
  }

  const old = existing[0];
  const hasSeed = (old.dataSources || []).includes('seed');
  const hasCheapShark = (old.dataSources || []).includes('cheapshark');

  // 智能合并
  const merged = {
    // 中文字段：seed 优先
    name: hasSeed ? old.name : (old.name || data.nameEn),
    nameEn: data.nameEn,
    description: hasSeed && old.description ? old.description : data.description,
    detailedDescription: data.detailedDescription, // Steam 富文本永远覆盖（更新）
    // 价格：CheapShark > SteamStore（CheapShark 折扣更实时）
    price: hasCheapShark ? old.price : data.price,
    originalPrice: hasCheapShark ? old.originalPrice : data.originalPrice,
    discount: hasCheapShark ? old.discount : data.discount,
    isFree: data.isFree,
    // 截图视频：Steam 是权威源，覆盖
    cover: old.cover || data.cover,
    headerImage: data.headerImage,
    screenshots: data.screenshots.length > 0 ? data.screenshots : old.screenshots,
    videos: data.videos.length > 0 ? data.videos : old.videos,
    // 标签合并去重
    tags: Array.from(new Set([...(old.tags || []), ...data.tags])),
    platforms: Array.from(new Set([...(old.platforms || []), ...data.platforms])),
    developer: old.developer || data.developer,
    publisher: old.publisher || data.publisher,
    releasedAt: old.releasedAt || data.releasedAt,
    supportedLanguages: data.supportedLanguages,
    metacritic: data.metacritic || old.metacritic || 0,
    storeUrls: { ...data.storeUrls, ...(old.storeUrls || {}) },
    // 评分：Metacritic 是权威，若 seed 没设过则覆盖
    rating: (hasSeed && old.rating) ? old.rating : (data.metacritic ? data.metacritic / 10 : old.rating || 0),
    dataSources: Array.from(new Set([...(old.dataSources || []), 'steamstore'])),
    updatedAt: now,
    'lastSyncedAt.steamstore': now,
  };

  await gamesCol.doc(old._id).update({ data: merged });
  return 'updated';
}

// ============ 主入口 ============
// event 参数：
//   - appids: 指定 appid 数组（不传则从 games 集合拉所有有 steam id 的）
//   - limit: 单次处理数量上限（默认 20，避免超时）
//   - cc: 国家代码（默认 cn，价格按人民币）
//   - lang: 语言（默认 schinese）
//   - delayMs: 每次请求间隔（默认 800ms，避免被 Steam 限流）
exports.main = async (event, context) => {
  const {
    appids,
    limit = 20,
    cc = 'cn',
    lang = 'schinese',
    delayMs = 800,
  } = event;

  // 1. 确定要处理的 appid 列表
  let targetAppids = appids;
  if (!targetAppids || targetAppids.length === 0) {
    // 默认只取"有 Steam ID + 还没被 steamstore 同步过"的游戏
    // 这样多次调用能逐步覆盖所有游戏，不会重复处理
    const baseQuery = event.force
      ? { 'externalIds.steam': db.command.exists(true) }
      : {
          'externalIds.steam': db.command.exists(true),
          dataSources: db.command.nin(['steamstore']),
        };

    const { data } = await gamesCol
      .where(baseQuery)
      .field({ 'externalIds.steam': true })
      .limit(limit)
      .get();
    targetAppids = data.map((g) => g.externalIds.steam).filter(Boolean);
  } else {
    targetAppids = targetAppids.slice(0, limit);
  }

  if (targetAppids.length === 0) {
    return { code: 0, message: 'no appids to process', data: { total: 0 } };
  }

  // 2. 逐个拉取详情
  const stats = {
    total: targetAppids.length,
    inserted: 0,
    updated: 0,
    failed: 0,
    notFound: 0,
    failures: [],
  };

  for (const appid of targetAppids) {
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&l=${lang}`;
      const json = await httpGetWithRetry(url);

      const item = json[appid];
      if (!item || !item.success) {
        stats.notFound++;
        continue;
      }

      const normalized = normalize(item.data);
      const result = await upsertGame(normalized);
      stats[result]++;
    } catch (e) {
      stats.failed++;
      stats.failures.push({ appid, error: e.message });
      console.error('[SteamStore] error', appid, e.message);
    }

    // Steam 限流保护
    if (delayMs > 0) await sleep(delayMs);
  }

  return {
    code: 0,
    message: 'ok',
    data: { source: 'steamstore', cc, lang, ...stats },
  };
};
