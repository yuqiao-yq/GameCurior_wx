// pages/mine/history/history.js
// 浏览历史：按日期分组展示，支持单条删除与一键清空
const cloud = require('../../../utils/cloud.js');

Page({
  data: {
    list: [],            // 原始列表 [{ _id, gameId, viewedAt, game }]
    groups: [],          // 分组后 [{ label, items }]
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    inited: false,
  },

  onLoad() {
    this.fetchList({ reset: true });
  },

  onShow() {
    // 从详情页返回时刷新（可能产生了新的浏览记录）
    if (this.data.inited) {
      this.fetchList({ reset: true });
    }
  },

  // ============ 拉数据 ============
  async fetchList({ reset = false }) {
    if (this.data.loading) return;
    if (!reset && !this.data.hasMore) return;

    this.setData({ loading: true });
    const page = reset ? 1 : this.data.page;
    const { pageSize } = this.data;

    try {
      const data = await cloud.callFunction(
        'history',
        { action: 'list', page, pageSize },
        { showError: false }
      );
      const newList = (data.list || []).filter((item) => item.game); // 过滤掉已下架的
      const merged = reset ? newList : [...this.data.list, ...newList];

      this.setData({
        list: merged,
        groups: this.groupByDate(merged),
        page: page + 1,
        hasMore: !!data.hasMore,
        inited: true,
      });
    } catch (err) {
      console.warn('[history] fetch fail:', err);
      this.setData({ inited: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 按日期分组（今天 / 昨天 / 更早）
  groupByDate(list) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const groups = { today: [], yesterday: [], earlier: [] };
    list.forEach((item) => {
      const t = new Date(item.viewedAt).getTime();
      if (t >= today.getTime()) groups.today.push(item);
      else if (t >= yesterday.getTime()) groups.yesterday.push(item);
      else groups.earlier.push(item);
    });

    const result = [];
    if (groups.today.length) result.push({ label: '今天', items: groups.today });
    if (groups.yesterday.length) result.push({ label: '昨天', items: groups.yesterday });
    if (groups.earlier.length) result.push({ label: '更早', items: groups.earlier });
    return result;
  },

  onPullDownRefresh() {
    this.fetchList({ reset: true }).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.fetchList({ reset: false });
    }
  },

  // ============ 跳详情 ============
  handleItemTap(e) {
    const { gameId } = e.currentTarget.dataset;
    if (!gameId) return;
    wx.navigateTo({ url: `/pages/game/detail/detail?id=${gameId}` });
  },

  // ============ 单条删除 ============
  async handleRemove(e) {
    e.stopPropagation && e.stopPropagation();
    const { id } = e.currentTarget.dataset;
    if (!id) return;

    try {
      await cloud.callFunction('history', { action: 'remove', id });
      // 本地直接过滤掉，避免重拉
      const list = this.data.list.filter((item) => item._id !== id);
      this.setData({
        list,
        groups: this.groupByDate(list),
      });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      // 错误 toast 已由 cloud.js 弹出
    }
  },

  // ============ 一键清空 ============
  handleClear() {
    if (this.data.list.length === 0) {
      wx.showToast({ title: '暂无历史记录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '提示',
      content: '确定清空全部浏览历史？',
      confirmColor: '#f53f3f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const data = await cloud.callFunction('history', { action: 'clear' });
          this.setData({ list: [], groups: [], hasMore: false });
          wx.showToast({ title: `已清空 ${data.removed} 条`, icon: 'success' });
        } catch (err) {
          // 错误 toast 已弹
        }
      },
    });
  },
});
