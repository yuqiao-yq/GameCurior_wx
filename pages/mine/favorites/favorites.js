// pages/mine/favorites/favorites.js
const cloud = require('../../../utils/cloud.js');

const STATUS_TABS = [
  { value: null, label: '全部' },
  { value: 0, label: '想玩' },
  { value: 1, label: '在玩' },
  { value: 2, label: '玩过' },
  { value: 3, label: '弃坑' },
];

Page({
  data: {
    tabs: STATUS_TABS,
    activeTab: 0,            // 当前选中的 tab 下标
    list: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    refreshing: false,
  },

  onLoad() {
    this.fetchList({ reset: true });
  },

  onShow() {
    // 每次显示重新拉取，避免详情页改了收藏状态后回来不同步
    this.fetchList({ reset: true });
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true });
    this.fetchList({ reset: true }).finally(() => {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.fetchList({ reset: false });
    }
  },

  // 切换 Tab
  handleTabChange(e) {
    const { index } = e.currentTarget.dataset;
    if (index === this.data.activeTab) return;
    this.setData({ activeTab: index, list: [], page: 1, hasMore: true });
    this.fetchList({ reset: true });
  },

  async fetchList({ reset = false }) {
    if (this.data.loading) return;
    this.setData({ loading: true });

    const { activeTab, page, pageSize } = this.data;
    const currentTab = STATUS_TABS[activeTab];

    const params = {
      action: 'list',
      page: reset ? 1 : page,
      pageSize,
    };
    if (currentTab.value !== null) {
      params.status = currentTab.value;
    }

    try {
      const data = await cloud.callFunction('favorite', params, { showError: false });
      const newList = data.list || [];
      this.setData({
        list: reset ? newList : [...this.data.list, ...newList],
        page: (reset ? 1 : page) + 1,
        hasMore: data.hasMore,
      });
    } catch (err) {
      console.warn('fetch favorites failed:', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 跳转详情
  handleItemTap(e) {
    const { gameId } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${gameId}` });
  },

  // 修改收藏状态
  async handleChangeStatus(e) {
    e.stopPropagation && e.stopPropagation();
    const { gameId, currentStatus } = e.currentTarget.dataset;

    const itemList = ['想玩', '在玩', '玩过', '弃坑', '取消收藏'];
    const res = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList,
        success: (r) => resolve(r.tapIndex),
        fail: () => resolve(-1),
      });
    });

    if (res === -1) return;

    try {
      if (res === 4) {
        // 取消收藏
        await cloud.callFunction('favorite', { action: 'remove', gameId });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      } else {
        await cloud.callFunction('favorite', {
          action: 'updateStatus',
          gameId,
          status: res,
        });
        wx.showToast({ title: `已标记为「${itemList[res]}」`, icon: 'success' });
      }
      // 刷新列表
      this.fetchList({ reset: true });
    } catch (err) {
      // 错误 toast 已在 cloud.js 里弹了
    }
  },
});
