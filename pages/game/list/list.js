// pages/game/list/list.js
// 游戏列表页：可按分类、标签、排序展示，支持分页
const cloud = require('../../../utils/cloud.js');

const SORT_TABS = [
  { key: 'rating', label: '评分' },
  { key: 'new', label: '最新' },
  { key: 'hot', label: '最热' },
];

Page({
  data: {
    title: '',
    categoryId: '',
    tag: '',
    sortTabs: SORT_TABS,
    sort: 'rating',
    list: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    inited: false,
  },

  onLoad(options = {}) {
    const { categoryId = '', tag = '', name = '', sort = 'rating' } = options;
    const title = decodeURIComponent(name || tag || categoryId || '游戏列表');

    this.setData({
      title,
      categoryId,
      tag,
      sort: SORT_TABS.find((t) => t.key === sort) ? sort : 'rating',
    });
    wx.setNavigationBarTitle({ title });
    this.fetchList({ reset: true });
  },

  handleSortChange(e) {
    const { key } = e.currentTarget.dataset;
    if (key === this.data.sort) return;
    this.setData({ sort: key, list: [], page: 1, hasMore: true });
    this.fetchList({ reset: true });
  },

  async fetchList({ reset = false }) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    const { categoryId, tag, sort, pageSize } = this.data;
    const page = reset ? 1 : this.data.page;

    const params = { page, pageSize, sort };
    if (categoryId) params.categoryId = categoryId;
    if (tag) params.tag = tag;

    try {
      const data = await cloud.callFunction('getGameList', params, { showError: false });
      const newList = data.list || [];
      this.setData({
        list: reset ? newList : [...this.data.list, ...newList],
        page: page + 1,
        hasMore: !!data.hasMore,
        inited: true,
      });
    } catch (err) {
      console.warn('[game/list] fetch fail:', err);
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

  handleGameTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${id}` });
  },

  onShareAppMessage() {
    const { title, categoryId, tag } = this.data;
    let query = '';
    if (categoryId) query = `categoryId=${categoryId}&name=${encodeURIComponent(title)}`;
    else if (tag) query = `tag=${encodeURIComponent(tag)}`;
    return {
      title: `${title} - GameCurior 游戏推荐`,
      path: `/pages/game/list/list?${query}`,
    };
  },
});
