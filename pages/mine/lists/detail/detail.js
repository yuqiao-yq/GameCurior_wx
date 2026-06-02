// pages/mine/lists/detail/detail.js
// 清单详情：游戏卡片网格 + 单击游戏编辑评分/评价 + 导出分享图（Phase 4）
const cloud = require('../../../../utils/cloud.js');

const REVIEW_MAX = 500;

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

  // ============ 导出分享图（Phase 4 占位） ============
  handleExportImage() {
    wx.showToast({ title: '分享图导出开发中', icon: 'none' });
    // TODO: Phase 4 实现
  },

  onShareAppMessage() {
    const list = this.data.list || {};
    return {
      title: `${list.name || '我的游戏清单'} - GameCurior`,
      path: `/pages/mine/lists/detail/detail?id=${this.data.id}`,
    };
  },
});
