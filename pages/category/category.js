// pages/category/category.js
// 分类页：展示从 categories 集合拉取的分类，点击进入该分类的游戏列表
const cloud = require('../../utils/cloud.js');

Page({
  data: {
    categories: [],
    loading: true,
  },

  onLoad() {
    this.fetchCategories();
  },

  async fetchCategories() {
    this.setData({ loading: true });
    try {
      // 这里直接走云数据库（categories 集合是「所有用户可读」）
      const db = cloud.db();
      const { data } = await db.collection('categories')
        .orderBy('sort', 'asc')
        .limit(50)
        .get();
      this.setData({ categories: data || [], loading: false });
    } catch (err) {
      console.warn('fetch categories failed:', err);
      this.setData({ loading: false });
    }
  },

  handleCategoryTap(e) {
    const { id, name } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/game/list/list?categoryId=${id}&name=${encodeURIComponent(name || '')}`,
    });
  },
});
