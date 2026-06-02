// pages/mine/lists/detail/detail.js
// 清单详情：游戏卡片网格 + 单击游戏编辑评分/评价 + Canvas 导出分享图
const cloud = require('../../../../utils/cloud.js');

const REVIEW_MAX = 500;

// ============ 分享图导出配置 ============
const SHARE_CONFIG = {
  width: 750,
  heroHeight: 400,
  itemHeight: 200,
  footerHeight: 120,
  maxItems: 20,         // 一张图最多绘制 20 款游戏（避免过长）
  padding: 32,
};

Page({
  data: {
    id: '',
    list: null,
    items: [],
    loading: true,
    // 评价编辑 modal
    modalVisible: false,
    editing: {
      itemId: '',
      gameId: '',
      gameName: '',
      gameCover: '',
      rating: 0,
      review: '',
    },
    reviewLen: 0,
    saving: false,
    REVIEW_MAX,
  },

  onLoad(options = {}) {
    const { id } = options;
    if (!id) {
      wx.showToast({ title: '缺少清单 id', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ id });
    this.fetchDetail();
  },

  onShow() {
    // 从搜索/详情页加入新游戏后回来需刷新
    if (this.data.id && !this.data.loading) {
      this.fetchDetail();
    }
  },

  async fetchDetail() {
    this.setData({ loading: true });
    try {
      const data = await cloud.callFunction(
        'gameList',
        { action: 'detail', id: this.data.id, withItems: true },
        { showError: true }
      );
      this.setData({
        list: data.list,
        items: data.items || [],
        loading: false,
      });
      if (data.list && data.list.name) {
        wx.setNavigationBarTitle({ title: data.list.name });
      }
    } catch (err) {
      console.warn('[lists/detail] fetch fail:', err);
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.fetchDetail().finally(() => wx.stopPullDownRefresh());
  },

  // ============ 添加游戏：跳搜索页（携带 listId） ============
  handleAddGame() {
    // 把当前 listId 写进 storage，搜索页/详情页发现该标记时显示"加入清单"按钮
    try {
      wx.setStorageSync('addToList:context', {
        listId: this.data.id,
        listName: this.data.list && this.data.list.name,
        timestamp: Date.now(),
      });
    } catch (e) {}
    wx.navigateTo({ url: '/pages/search/search' });
  },

  // ============ 点击游戏卡片：进入评价 modal ============
  handleItemTap(e) {
    const { item } = e.currentTarget.dataset;
    if (!item || !item.game) return;
    this.setData({
      modalVisible: true,
      editing: {
        itemId: item._id,
        gameId: item.gameId,
        gameName: item.game.name,
        gameCover: item.game.cover || item.game.headerImage,
        rating: item.rating || 0,
        review: item.review || '',
      },
      reviewLen: (item.review || '').length,
    });
  },

  // 长按：操作菜单（查看详情 / 移除）
  handleItemLongPress(e) {
    const { item } = e.currentTarget.dataset;
    if (!item) return;
    wx.showActionSheet({
      itemList: ['查看游戏详情', '从清单中移除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/game/detail/detail?id=${item.gameId}` });
        } else if (res.tapIndex === 1) {
          this.confirmRemove(item);
        }
      },
    });
  },

  async confirmRemove(item) {
    const name = (item.game && item.game.name) || '该游戏';
    const res = await new Promise((resolve) => {
      wx.showModal({
        title: '移除游戏',
        content: `确认从清单中移除「${name}」？\n评分与评价将一同删除。`,
        confirmColor: '#f53f3f',
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      });
    });
    if (!res) return;
    try {
      await cloud.callFunction('gameListItem', { action: 'remove', id: item._id });
      wx.showToast({ title: '已移除', icon: 'success' });
      // 本地立即过滤 + 清单游戏数 -1
      const items = this.data.items.filter((i) => i._id !== item._id);
      const list = { ...this.data.list, gameCount: Math.max(0, (this.data.list.gameCount || 0) - 1) };
      this.setData({ items, list });
    } catch (e) {}
  },

  // ============ 评价 modal ============
  handleRatingTap(e) {
    const { score } = e.currentTarget.dataset;
    const val = Number(score) || 0;
    // 点击同一颗星可清除（变成 0）
    const next = this.data.editing.rating === val ? 0 : val;
    this.setData({ 'editing.rating': next });
  },

  handleReviewInput(e) {
    const review = String(e.detail.value || '').slice(0, REVIEW_MAX);
    this.setData({ 'editing.review': review, reviewLen: review.length });
  },

  handleCloseModal() {
    if (this.data.saving) return;
    this.setData({ modalVisible: false });
  },

  // 点击 mask 关闭（catchtap 阻止冒泡到 popup）
  handleStopPropagation() {},

  async handleSaveReview() {
    if (this.data.saving) return;
    const { itemId, rating, review } = this.data.editing;
    if (!itemId) return;

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const data = await cloud.callFunction(
        'gameListItem',
        { action: 'updateReview', id: itemId, rating, review: review.trim() },
        { showError: false }
      );
      wx.hideLoading();
      // 本地同步
      const items = this.data.items.map((i) =>
        i._id === itemId ? { ...i, rating: data.item.rating, review: data.item.review } : i
      );
      this.setData({ items, modalVisible: false });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      const msg = (e && e.message) || '保存失败';
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ============ 导出分享图 ============
  async handleExportImage() {
    const { list, items } = this.data;
    if (!list) return;

    const usedItems = items.slice(0, SHARE_CONFIG.maxItems);
    if (items.length > SHARE_CONFIG.maxItems) {
      wx.showToast({
        title: `仅导出前 ${SHARE_CONFIG.maxItems} 款游戏`,
        icon: 'none',
        duration: 1500,
      });
      await sleep(1500);
    }

    wx.showLoading({ title: '生成分享图…', mask: true });

    try {
      // 1. 准备所有需要绘制的图片（cover 是云存储 fileID 时先转 https）
      const imgUrls = await this.prepareImageUrls(list, usedItems);

      // 2. 获取 Canvas 节点
      const canvas = await this.getCanvasNode();
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;

      const w = SHARE_CONFIG.width;
      const h = SHARE_CONFIG.heroHeight
        + usedItems.length * SHARE_CONFIG.itemHeight
        + SHARE_CONFIG.footerHeight;

      // 设置物理像素
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      // 3. 绘制
      await this.drawShareImage(canvas, ctx, { list, items: usedItems, imgUrls, width: w, height: h });

      // 4. 导出
      const tempPath = await new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas,
          fileType: 'jpg',
          quality: 0.9,
          success: (res) => resolve(res.tempFilePath),
          fail: reject,
        });
      });

      wx.hideLoading();
      // 5. 预览图片（用户可在预览页保存到相册）
      wx.previewImage({
        urls: [tempPath],
        current: tempPath,
      });

      // 同步把"上次导出图"存起来，方便'再次保存'按钮
      this.setData({ lastSharePath: tempPath });
    } catch (err) {
      console.error('[exportImage] fatal:', err);
      wx.hideLoading();
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },

  // ============ 拿 Canvas 节点 ============
  getCanvasNode() {
    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#share-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res[0] && res[0].node;
          if (!canvas) return reject(new Error('canvas node not found'));
          resolve(canvas);
        });
    });
  },

  // ============ 把云存储 fileID 转 https ============
  async prepareImageUrls(list, items) {
    const fileIDs = [];
    if (list.cover && list.cover.startsWith('cloud://')) {
      fileIDs.push(list.cover);
    }
    items.forEach((item) => {
      const cover = item.game && (item.game.cover || item.game.headerImage);
      if (cover && cover.startsWith('cloud://')) fileIDs.push(cover);
    });

    let cloudMap = {};
    if (fileIDs.length > 0) {
      try {
        const res = await wx.cloud.getTempFileURL({ fileList: [...new Set(fileIDs)] });
        (res.fileList || []).forEach((f) => {
          if (f.tempFileURL) cloudMap[f.fileID] = f.tempFileURL;
        });
      } catch (e) {
        console.warn('[exportImage] getTempFileURL fail:', e);
      }
    }

    const resolve = (url) => (url && cloudMap[url]) || url || '';

    return {
      listCover: resolve(list.cover),
      items: items.map((item) => ({
        cover: resolve(item.game && (item.game.cover || item.game.headerImage)),
      })),
    };
  },

  // ============ 绘制分享图 ============
  async drawShareImage(canvas, ctx, opts) {
    const { list, items, imgUrls, width, height } = opts;

    // 整体背景白色
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // ========== 1. Hero 区 ==========
    const heroH = SHARE_CONFIG.heroHeight;
    // 背景：图 / 渐变
    if (imgUrls.listCover) {
      try {
        const img = await loadImage(canvas, imgUrls.listCover);
        // cover 比例平铺
        drawImageCover(ctx, img, 0, 0, width, heroH);
      } catch (e) {
        drawGradient(ctx, 0, 0, width, heroH, '#667eea', '#5b3aa8');
      }
    } else {
      drawGradient(ctx, 0, 0, width, heroH, '#667eea', '#5b3aa8');
    }

    // 黑色渐变蒙层
    const grad = ctx.createLinearGradient(0, 0, 0, heroH);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, heroH);

    // 清单文案
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 44px sans-serif';
    ctx.textBaseline = 'alphabetic';
    drawWrappedText(ctx, list.name || '我的游戏清单', SHARE_CONFIG.padding, heroH - 140, width - 2 * SHARE_CONFIG.padding, 52, 2);

    if (list.description) {
      ctx.font = '24px sans-serif';
      ctx.globalAlpha = 0.92;
      drawWrappedText(ctx, list.description, SHARE_CONFIG.padding, heroH - 70, width - 2 * SHARE_CONFIG.padding, 32, 2);
      ctx.globalAlpha = 1;
    }

    // 游戏数 + 时间
    ctx.font = '22px sans-serif';
    ctx.globalAlpha = 0.85;
    const metaText = `📚 ${items.length} 款游戏 · ${formatDate(list.updatedAt || list.createdAt)}`;
    ctx.fillText(metaText, SHARE_CONFIG.padding, heroH - 32);
    ctx.globalAlpha = 1;

    // ========== 2. 游戏列表 ==========
    let cursorY = heroH;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemH = SHARE_CONFIG.itemHeight;
      const url = imgUrls.items[i] && imgUrls.items[i].cover;

      // 分割线
      if (i > 0) {
        ctx.fillStyle = '#f2f3f5';
        ctx.fillRect(SHARE_CONFIG.padding, cursorY, width - 2 * SHARE_CONFIG.padding, 1);
      }

      // 排名徽章
      const badgeSize = 36;
      ctx.fillStyle = i < 3 ? '#f53f3f' : '#c9cdd4';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(SHARE_CONFIG.padding, cursorY + 28, badgeSize, badgeSize, 8);
      } else {
        ctx.rect(SHARE_CONFIG.padding, cursorY + 28, badgeSize, badgeSize);
      }
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), SHARE_CONFIG.padding + badgeSize / 2, cursorY + 28 + badgeSize / 2 + 8);
      ctx.textAlign = 'left';

      // 封面
      const coverX = SHARE_CONFIG.padding + badgeSize + 16;
      const coverY = cursorY + 24;
      const coverW = 110;
      const coverH = 140;
      if (url) {
        try {
          const img = await loadImage(canvas, url);
          drawRoundedImage(ctx, img, coverX, coverY, coverW, coverH, 8);
        } catch (e) {
          ctx.fillStyle = '#f2f3f5';
          ctx.fillRect(coverX, coverY, coverW, coverH);
        }
      } else {
        ctx.fillStyle = '#f2f3f5';
        ctx.fillRect(coverX, coverY, coverW, coverH);
      }

      // 文案
      const textX = coverX + coverW + 20;
      const textW = width - textX - SHARE_CONFIG.padding;
      // 名称
      ctx.fillStyle = '#1f2329';
      ctx.font = 'bold 30px sans-serif';
      const gameName = (item.game && item.game.name) || '未知游戏';
      ctx.fillText(truncate(ctx, gameName, textW), textX, coverY + 28);

      // 评分
      if (item.rating > 0) {
        ctx.fillStyle = '#ff7d00';
        ctx.font = 'bold 26px sans-serif';
        ctx.fillText(`★ ${item.rating}`, textX, coverY + 62);
        ctx.fillStyle = '#c9cdd4';
        ctx.font = '20px sans-serif';
        const ratingTextW = ctx.measureText(`★ ${item.rating}`).width;
        ctx.fillText(' / 10', textX + ratingTextW, coverY + 62);
      } else {
        ctx.fillStyle = '#c9cdd4';
        ctx.font = '24px sans-serif';
        ctx.fillText('未评分', textX, coverY + 62);
      }

      // 评价
      if (item.review) {
        ctx.fillStyle = '#4e5969';
        ctx.font = '22px sans-serif';
        drawWrappedText(ctx, `"${item.review}"`, textX, coverY + 96, textW, 30, 2);
      }

      cursorY += itemH;
    }

    // ========== 3. Footer ==========
    drawGradient(ctx, 0, cursorY, width, SHARE_CONFIG.footerHeight, '#667eea', '#5b3aa8');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🎮 GameCurior', width / 2, cursorY + 48);
    ctx.font = '20px sans-serif';
    ctx.globalAlpha = 0.88;
    ctx.fillText('发现你感兴趣的好玩游戏 · 微信搜索同名小程序', width / 2, cursorY + 82);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  },

  onShareAppMessage() {
    const list = this.data.list || {};
    return {
      title: `${list.name || '我的游戏清单'} - GameCurior`,
      path: `/pages/mine/lists/detail/detail?id=${this.data.id}`,
    };
  },
});

// ============ Canvas 工具函数 ============

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 加载图片（Canvas 2D 模式）
function loadImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const img = canvas.createImage();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

// 渐变背景
function drawGradient(ctx, x, y, w, h, c1, c2) {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, c1);
  g.addColorStop(1, c2);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// aspectFill 绘图（保持比例填满，超出部分裁剪）
function drawImageCover(ctx, img, dx, dy, dw, dh) {
  const srcRatio = img.width / img.height;
  const dstRatio = dw / dh;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (srcRatio > dstRatio) {
    // 源更宽，裁两侧
    sw = img.height * dstRatio;
    sx = (img.width - sw) / 2;
  } else {
    // 源更窄，裁上下
    sh = img.width / dstRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// 圆角图片
function drawRoundedImage(ctx, img, x, y, w, h, r) {
  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // 兼容回退：用 4 段贝塞尔曲线画圆角矩形
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  ctx.clip();
  drawImageCover(ctx, img, x, y, w, h);
  ctx.restore();
}

// 截断文本到指定宽度
function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 0 && ctx.measureText(result + '…').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

// 文本自动换行（最多 maxLines 行，超出截断）
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = String(text).split('');
  let line = '';
  let lineIdx = 0;
  let cursorY = y;

  for (let i = 0; i < chars.length; i++) {
    const testLine = line + chars[i];
    if (ctx.measureText(testLine).width > maxWidth) {
      // 当前行写出
      if (lineIdx === maxLines - 1) {
        // 最后一行，加省略号
        let last = line;
        while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
          last = last.slice(0, -1);
        }
        ctx.fillText(last + '…', x, cursorY);
        return;
      }
      ctx.fillText(line, x, cursorY);
      line = chars[i];
      cursorY += lineHeight;
      lineIdx++;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}

// 格式化日期：2026/06/02
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}
