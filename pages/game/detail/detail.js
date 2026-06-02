// pages/game/detail/detail.js
const cloud = require('../../../utils/cloud.js');
const app = getApp();

Page({
  data: {
    id: '',
    game: null,
    related: [],
    favorited: false,
    favoriteStatus: 0,
    loading: true,
    // 用于 wxs 计算
    showDescriptionAll: false, // 详细描述是否展开
  },

  onLoad(options) {
    const { id } = options || {};
    if (!id) {
      wx.showToast({ title: '游戏 ID 缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1000);
      return;
    }
    this.setData({ id });
    this.fetchDetail(id);
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const data = await cloud.callFunction(
        'getGameDetail',
        { id, reportHistory: true },
        { showError: true }
      );

      // 去掉 detailedDescription 里的 HTML 标签，做个简单文本展示
      const game = data.game || {};
      if (game.detailedDescription) {
        game.detailedDescriptionText = stripHtml(game.detailedDescription).slice(0, 600);
      }

      // 设置导航栏标题
      if (game.name) {
        wx.setNavigationBarTitle({ title: game.name });
      }

      this.setData({
        game,
        related: data.related || [],
        favorited: (data.userContext && data.userContext.favorited) || false,
        favoriteStatus: (data.userContext && data.userContext.favoriteStatus) || 0,
        loading: false,
      });
    } catch (err) {
      console.error('获取游戏详情失败：', err);
      this.setData({ loading: false });
    }
  },

  // 收藏 / 取消收藏
  async handleToggleFavorite() {
    const { id, favorited } = this.data;
    wx.showLoading({ title: favorited ? '取消中' : '收藏中', mask: true });
    try {
      const data = await cloud.callFunction('favorite', { action: 'toggle', gameId: id });
      this.setData({ favorited: data.favorited });
      wx.hideLoading();
      wx.showToast({
        title: data.favorited ? '已收藏' : '已取消',
        icon: 'success',
      });
    } catch (err) {
      wx.hideLoading();
    }
  },

  // 跳转商店（小程序内不能直接打开外部链接，复制到剪贴板）
  handleVisitStore() {
    const { game } = this.data;
    const url = game && game.storeUrls && game.storeUrls.steam;
    if (!url) {
      wx.showToast({ title: '暂无商店链接', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showModal({
          title: '链接已复制',
          content: '在浏览器中粘贴打开 Steam 商店页',
          showCancel: false,
        });
      },
    });
  },

  // 截图轮播预览
  handlePreviewScreenshot(e) {
    const { index } = e.currentTarget.dataset;
    const { screenshots } = this.data.game || {};
    if (!screenshots || screenshots.length === 0) return;
    wx.previewImage({
      current: screenshots[index],
      urls: screenshots,
    });
  },

  // 切换详细描述展开/折叠
  handleToggleDescription() {
    this.setData({ showDescriptionAll: !this.data.showDescriptionAll });
  },

  // 跳转到相关游戏
  handleRelatedTap(e) {
    const { id } = e.currentTarget.dataset;
    wx.redirectTo({ url: `/pages/game/detail/detail?id=${id}` });
  },

  // 分享
  onShareAppMessage() {
    const { game } = this.data;
    if (!game) return {};
    return {
      title: `${game.name} - ${game.description || ''}`.slice(0, 60),
      path: `/pages/game/detail/detail?id=${this.data.id}`,
      imageUrl: game.cover || game.headerImage,
    };
  },

  onShareTimeline() {
    const { game } = this.data;
    if (!game) return {};
    return {
      title: `${game.name} - ${game.description || ''}`.slice(0, 60),
      imageUrl: game.cover || game.headerImage,
    };
  },
});

// 简单的 HTML 标签剥离（用于在小程序里展示 Steam 的富文本）
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
