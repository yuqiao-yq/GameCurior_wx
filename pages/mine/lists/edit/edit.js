// pages/mine/lists/edit/edit.js
// 清单创建 / 编辑：名称、简介、封面（自定义上传）
const cloud = require('../../../../utils/cloud.js');
const app = getApp();

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
    // 确保已登录拿到 openid（用于云存储上传路径，避开公共目录权限问题）
    this.ensureLogin();

    const { id } = options;
    if (id) {
      this.setData({ isEdit: true, id });
      wx.setNavigationBarTitle({ title: '编辑清单' });
      this.fetchDetail(id);
    } else {
      wx.setNavigationBarTitle({ title: '新建清单' });
    }
  },

  // 确保有 openid，避免上传走公共目录被权限拦截
  async ensureLogin() {
    if (app.globalData && app.globalData.openid) return;
    try {
      const data = await cloud.callFunction('login', {}, { showError: false });
      if (app.globalData && data) {
        app.globalData.openid = data.openid;
        app.globalData.userInfo = data.user;
      }
    } catch (e) {
      // 静默
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
  // 路径策略：list-covers/{openid}/xxx.jpg，避开公共根目录权限
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

      // 确保有 openid
      await this.ensureLogin();
      const openid = (app.globalData && app.globalData.openid) || 'anon';

      wx.showLoading({ title: '上传中', mask: true });
      const ts = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      // 关键：openid 作为目录前缀，云存储默认安全规则就能匹配"自己的目录"
      const cloudPath = `list-covers/${openid}/${ts}_${rand}.jpg`;
      const fileID = await cloud.uploadFile(cloudPath, tempPath);
      this.setData({ 'form.cover': fileID });
      wx.hideLoading();
      wx.showToast({ title: '封面已上传', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      if (e && e.errMsg && e.errMsg.includes('cancel')) return;

      // 打印详细错误，便于排查
      console.error('[lists/edit] uploadCover fail:', e);
      const detail = (e && (e.errMsg || e.message)) || '未知错误';
      let tip = '上传失败';
      if (/permission/i.test(detail)) {
        tip = '云存储无写权限，请检查权限规则';
      } else if (/upload\s*fail/i.test(detail) || /timeout/i.test(detail)) {
        tip = '上传失败，请检查网络';
      } else if (/cloud function service error/i.test(detail)) {
        tip = '云开发未就绪';
      }
      wx.showModal({
        title: tip,
        content: `详细信息：${detail}`,
        showCancel: false,
      });
    }
  },

  // 封面图加载失败时给出提示
  handleCoverError(e) {
    console.warn('[lists/edit] cover image load failed:', e.detail);
    // 不自动清空，让用户能看到 fileID 已上传成功（仅预览失败）
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
