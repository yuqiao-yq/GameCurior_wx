// pages/search/result/result.js
// 搜索结果页：本地结果 + 外部数据源（CheapShark/Steam Store）扩展搜索
// - 默认 includeExternal=true，首屏并发拉取外部源
// - 点击外部结果 → 调 importGame 入库 → 跳转详情页
const cloud = require('../../../utils/cloud.js');

const SORT_TABS = [
  { key: 'rating', label: '评分' },
  { key: 'new', label: '最新' },
  { key: 'hot', label: '最热' },
];

Page({
  data: {
    keyword: '',
    sortTabs: SORT_TABS,
    sort: 'rating',
    list: [],
    external: [],          // 外部数据源结果（仅首屏，不分页）
    importingId: '',       // 正在导入的外部条目 _id（用于按钮 loading 状态）
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    inited: false,
  },

  onLoad(options) {
    const keyword = decodeURIComponent((options && options.keyword) || '').trim();
    if (!keyword) {
      wx.showToast({ title: '关键词缺失', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ keyword });
    wx.setNavigationBarTitle({ title: `“${keyword}”` });
    this.fetchList({ reset: true });
  },

  // 排序切换
  handleSortChange(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.sort) return;
    this.setData({ sort: key, list: [], external: [], page: 1, hasMore: true });
    this.fetchList({ reset: true });
  },

  // 拉数据
  async fetchList({ reset = false }) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    const { keyword, sort, pageSize } = this.data;
    const page = reset ? 1 : this.data.page;
    // 仅首屏带外部搜索（避免每次翻页都打外部 API）
    const includeExternal = page === 1;

    try {
      const data = await cloud.callFunction(
        'searchGames',
        { action: 'search', keyword, sort, page, pageSize, includeExternal },
        { showError: false }
      );
      const newList = data.list || [];
      const patch = {
        list: reset ? newList : [...this.data.list, ...newList],
        page: page + 1,
        hasMore: !!data.hasMore,
        inited: true,
      };
      if (reset) patch.external = data.external || [];
      this.setData(patch);
    } catch (err) {
      console.warn('[search:result] fetch fail:', err);
      this.setData({ inited: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.fetchList({ reset: true }).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.fetchList({ reset: false });
    }
  },

  // 点击搜索框：返回搜索页编辑
  handleEditKeyword() {
    wx.navigateBack({ delta: 1, fail: () => wx.redirectTo({ url: '/pages/search/search' }) });
  },

  // 跳详情（本地结果）
  handleGameTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${id}` });
  },

  // 点击外部结果：先导入到本地库，再跳详情
  async handleExternalTap(e) {
    const { item } = e.currentTarget.dataset;
    if (!item || !item._externalId) return;
    if (this.data.importingId) return; // 防止重复点击

    this.setData({ importingId: item._id });
    wx.showLoading({ title: '正在添加…', mask: true });

    try {
      const data = await cloud.callFunction(
        'importGame',
        { source: item._source || 'cheapshark', externalId: item._externalId },
        { showError: false }
      );
      wx.hideLoading();
      if (data && data._id) {
        const tip = data.isNew ? '已添加到游戏库' : '游戏已存在';
        wx.showToast({ title: tip, icon: 'success', duration: 1200 });
        // 短暂展示 toast 后跳详情
        setTimeout(() => {
          wx.navigateTo({ url: `/pages/game/detail/detail?id=${data._id}` });
        }, 600);
      } else {
        wx.showToast({ title: '添加失败，请稍后再试', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      const msg = (err && err.message) || '添加失败';
      wx.showToast({ title: msg, icon: 'none' });
    } finally {
      this.setData({ importingId: '' });
    }
  },

  onShareAppMessage() {
    return {
      title: `「${this.data.keyword}」相关游戏推荐`,
      path: `/pages/search/result/result?keyword=${encodeURIComponent(this.data.keyword)}`,
    };
  },
});
