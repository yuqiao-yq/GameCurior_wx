// pages/search/result/result.js
// 搜索结果页：根据关键词查询、分页加载、排序切换
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
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    inited: false, // 首次加载完成
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
    this.setData({ sort: key, list: [], page: 1, hasMore: true });
    this.fetchList({ reset: true });
  },

  // 拉数据
  async fetchList({ reset = false }) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    const { keyword, sort, pageSize } = this.data;
    const page = reset ? 1 : this.data.page;

    try {
      const data = await cloud.callFunction(
        'searchGames',
        { action: 'search', keyword, sort, page, pageSize },
        { showError: false }
      );
      const newList = data.list || [];
      this.setData({
        list: reset ? newList : [...this.data.list, ...newList],
        page: page + 1,
        hasMore: !!data.hasMore,
        inited: true,
      });
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

  // 跳详情
  handleGameTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${id}` });
  },

  onShareAppMessage() {
    return {
      title: `「${this.data.keyword}」相关游戏推荐`,
      path: `/pages/search/result/result?keyword=${encodeURIComponent(this.data.keyword)}`,
    };
  },
});
