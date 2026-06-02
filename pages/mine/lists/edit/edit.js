// pages/mine/lists/edit/edit.js
// 清单创建 / 编辑：名称、简介、封面（自定义上传）
const cloud = require('../../../../utils/cloud.js');

const NAME_MAX = 30;
const DESC_MAX = 200;

Page({
  data: {
    isEdit: false,
    id: '',
    form: {
      name: '',
      description: '',
      cover: '',  // 云存储 fileID
    },
    nameLen: 0,
    descLen: 0,
    loading: false,
    submitting: false,
    NAME_MAX,
    DESC_MAX,
  },

  onLoad(options = {}) {
    const { id } = options;
    if (id) {
      this.setData({ isEdit: true, id });
      wx.setNavigationBarTitle({ title: '编辑清单' });
      this.fetchDetail(id);
    } else {
      wx.setNavigationBarTitle({ title: '新建清单' });
    }
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const data = await cloud.callFunction(
        'gameList',
        { action: 'detail', id, withItems: false },
        { showError: true }
      );
      if (data && data.list) {
        const { name = '', description = '', cover = '' } = data.list;
        this.setData({
          form: { name, description, cover },
          nameLen: name.length,
          descLen: description.length,
        });
      }
    } catch (e) {
      console.warn('[lists:edit] fetch detail fail:', e);
      setTimeout(() => wx.navigateBack(), 1200);
    } finally {
      this.setData({ loading: false });
    }
  },

  // 输入
  handleNameInput(e) {
    const name = String(e.detail.value || '').slice(0, NAME_MAX);
    this.setData({ 'form.name': name, nameLen: name.length });
  },

  handleDescInput(e) {
    const description = String(e.detail.value || '').slice(0, DESC_MAX);
    this.setData({ 'form.description': description, descLen: description.length });
  },

  // 选 + 上传封面
  async handleChooseCover() {
    try {
      const choose = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
          success: resolve,
          fail: reject,
        });
      });
      const tempPath = choose.tempFiles && choose.tempFiles[0] && choose.tempFiles[0].tempFilePath;
      if (!tempPath) return;

      wx.showLoading({ title: '上传中', mask: true });
      const cloudPath = `list-cover/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const fileID = await cloud.uploadFile(cloudPath, tempPath);
      this.setData({ 'form.cover': fileID });
      wx.hideLoading();
      wx.showToast({ title: '封面已上传', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      if (e && e.errMsg && e.errMsg.includes('cancel')) return;
      wx.showToast({ title: '上传失败', icon: 'none' });
    }
  },

  handleRemoveCover() {
    this.setData({ 'form.cover': '' });
  },

  // 提交
  async handleSubmit() {
    if (this.data.submitting) return;
    const { isEdit, id, form } = this.data;
    const name = form.name.trim();
    if (!name) {
      wx.showToast({ title: '请输入清单名称', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: isEdit ? '保存中' : '创建中', mask: true });

    const payload = {
      action: isEdit ? 'update' : 'create',
      name,
      description: form.description.trim(),
      cover: form.cover || '',
    };
    if (isEdit) payload.id = id;

    try {
      await cloud.callFunction('gameList', payload, { showError: false });
      wx.hideLoading();
      wx.showToast({ title: isEdit ? '已保存' : '已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (e) {
      wx.hideLoading();
      const msg = (e && e.message) || '保存失败';
      wx.showToast({ title: msg, icon: 'none', duration: 2500 });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
