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
    // 暂时复用首页查询逻辑，跳到一个简化版的分类列表
    wx.showToast({ title: `${name} 分类页开发中`, icon: 'none' });
    // TODO: 后续做 pages/category/list?id=xxx
  },
});
