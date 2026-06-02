// components/banner-swiper/banner-swiper.js
// 首页 Banner 轮播：自动轮播 + 指示器 + linkType 跳转分发
//
// linkType 支持：
//   - game     → /pages/game/detail/detail?id={linkValue}
//   - rank     → switchTab /pages/rank/rank（可选 linkValue=hot/new/rating/discount，存到 storage 由 rank 页读取）
//   - category → switchTab /pages/category/category
//   - list     → /pages/game/list/list?categoryId={linkValue}（或 tag）
//   - search   → /pages/search/result/result?keyword={linkValue}
//   - external → 复制 URL 到剪贴板
//   - none     → 不响应

const RANK_PRESELECT_KEY = 'rank:preselect';

Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    banners: { type: Array, value: [] },
    autoplay: { type: Boolean, value: true },
    interval: { type: Number, value: 4000 },
    duration: { type: Number, value: 500 },
    // 圆角（外层容器）
    rounded: { type: Boolean, value: true },
  },

  methods: {
    handleTap(e) {
      const { item } = e.currentTarget.dataset;
      if (!item) return;

      this.triggerEvent('tap', { banner: item });

      const { linkType, linkValue } = item;
      switch (linkType) {
        case 'game':
          if (linkValue) {
            wx.navigateTo({ url: `/pages/game/detail/detail?id=${linkValue}` });
          }
          break;
        case 'rank':
          // 记录预选 tab，rank 页读取后清除
          if (linkValue) {
            try { wx.setStorageSync(RANK_PRESELECT_KEY, linkValue); } catch (e) {}
          }
          wx.switchTab({ url: '/pages/rank/rank' });
          break;
        case 'category':
          wx.switchTab({ url: '/pages/category/category' });
          break;
        case 'list':
          if (linkValue) {
            wx.navigateTo({
              url: `/pages/game/list/list?categoryId=${encodeURIComponent(linkValue)}&name=${encodeURIComponent(item.title || '')}`,
            });
          }
          break;
        case 'search':
          if (linkValue) {
            wx.navigateTo({
              url: `/pages/search/result/result?keyword=${encodeURIComponent(linkValue)}`,
            });
          }
          break;
        case 'external':
          if (linkValue) {
            wx.setClipboardData({
              data: linkValue,
              success: () => {
                wx.showModal({
                  title: '链接已复制',
                  content: '可在浏览器中粘贴打开',
                  showCancel: false,
                });
              },
            });
          }
          break;
        case 'none':
        default:
          // 不响应
          break;
      }
    },

    handleImageError(e) {
      console.warn('[banner-swiper] image load failed:', e.detail);
    },
  },
});
