// pages/mine/setting/setting.js
// 设置页：清缓存、关于、用户协议、隐私政策
const APP_VERSION = '0.1.0';

Page({
  data: {
    appVersion: APP_VERSION,
    cacheSize: '计算中…',
    groups: [
      {
        title: '通用',
        items: [
          { key: 'cache', icon: '🧹', label: '清除缓存', extraKey: 'cacheSize' },
        ],
      },
      {
        title: '法律条款',
        items: [
          { key: 'agreement', icon: '📄', label: '用户协议' },
          { key: 'privacy', icon: '🔒', label: '隐私政策' },
        ],
      },
      {
        title: '关于',
        items: [
          { key: 'about', icon: 'ℹ️', label: '关于 GameCurior', extra: `v${APP_VERSION}` },
          { key: 'feedback', icon: '💬', label: '意见反馈' },
        ],
      },
    ],
  },

  onLoad() {
    this.calcCacheSize();
  },

  // 计算缓存大小
  calcCacheSize() {
    wx.getStorageInfo({
      success: (res) => {
        const kb = res.currentSize || 0;
        const formatted = kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(2)} MB`;
        this.setData({ cacheSize: formatted });
      },
      fail: () => this.setData({ cacheSize: '0 KB' }),
    });
  },

  handleItemTap(e) {
    const { key } = e.currentTarget.dataset;
    switch (key) {
      case 'cache':
        return this.handleClearCache();
      case 'agreement':
        return wx.navigateTo({ url: '/pages/legal/agreement/agreement' });
      case 'privacy':
        return wx.navigateTo({ url: '/pages/legal/privacy/privacy' });
      case 'about':
        return this.handleAbout();
      case 'feedback':
        return this.handleFeedback();
      default:
        wx.showToast({ title: '功能开发中', icon: 'none' });
    }
  },

  handleClearCache() {
    wx.showModal({
      title: '清除缓存',
      content: '将清空本地搜索历史、临时图片等数据，云端数据不受影响。',
      confirmColor: '#5b3aa8',
      success: (res) => {
        if (!res.confirm) return;
        try {
          wx.clearStorageSync();
          this.calcCacheSize();
          wx.showToast({ title: '缓存已清除', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: '清除失败', icon: 'none' });
        }
      },
    });
  },

  handleAbout() {
    wx.showModal({
      title: 'GameCurior',
      content: `版本 v${APP_VERSION}\n\n面向轻度到中度玩家的游戏发现与策展工具。\n\n数据来源：Steam / SteamSpy / CheapShark / RAWG.io`,
      showCancel: false,
      confirmText: '知道了',
    });
  },

  handleFeedback() {
    wx.setClipboardData({
      data: 'zhuyuqiao@xiaohongshu.net',
      success: () => {
        wx.showModal({
          title: '联系开发者',
          content: '邮箱地址已复制到剪贴板：\nzhuyuqiao@xiaohongshu.net',
          showCancel: false,
        });
      },
    });
  },
});
