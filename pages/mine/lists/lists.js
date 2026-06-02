// pages/mine/lists/lists.js
// 我的游戏清单总览
const cloud = require('../../../utils/cloud.js');

Page({
  data: {
    lists: [],
    loading: false,
    inited: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
  },

  onLoad() {
    this.fetchList({ reset: true });
  },

  // 从详情页 / 创建页返回时刷新
  onShow() {
    if (this.data.inited) {
      this.fetchList({ reset: true });
    }
  },

  async fetchList({ reset = false } = {}) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    const { pageSize } = this.data;
    const page = reset ? 1 : this.data.page;

    try {
      const data = await cloud.callFunction(
        'gameList',
        { action: 'list', page, pageSize },
        { showError: false }
      );
      const newList = data.list || [];
      this.setData({
        lists: reset ? newList : [...this.data.lists, ...newList],
        page: page + 1,
        hasMore: !!data.hasMore,
        inited: true,
      });
    } catch (err) {
      console.warn('[lists] fetch fail:', err);
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

  // 创建新清单
  handleCreate() {
    wx.navigateTo({ url: '/pages/mine/lists/edit/edit' });
  },

  // 打开清单详情
  handleItemTap(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/mine/lists/detail/detail?id=${id}` });
  },

  // 编辑（长按）
  handleItemLongPress(e) {
    const { id, name } = e.currentTarget.dataset;
    if (!id) return;
    wx.showActionSheet({
      itemList: ['编辑信息', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: `/pages/mine/lists/edit/edit?id=${id}` });
        } else if (res.tapIndex === 1) {
          this.confirmDelete(id, name);
        }
      },
    });
  },

  confirmDelete(id, name) {
    wx.showModal({
      title: '删除清单',
      content: `确认删除「${name || '该清单'}」？\n清单内所有游戏与评价将一同删除。`,
      confirmColor: '#f53f3f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await cloud.callFunction('gameList', { action: 'delete', id });
          wx.showToast({ title: '已删除', icon: 'success' });
          // 本地立即过滤
          this.setData({ lists: this.data.lists.filter((l) => l._id !== id) });
        } catch (e) {
          // 错误 toast 已弹
        }
      },
    });
  },
});
