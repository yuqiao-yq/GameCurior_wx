// cloudfunctions/login/index.js
// 微信登录云函数：自动获取 openid，如未注册则在 users 集合创建记录
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const usersCol = db.collection('users');

exports.main = async (event, context) => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext();

  try {
    // 查询是否已存在该用户
    const { data: existing } = await usersCol
      .where({ _openid: OPENID })
      .limit(1)
      .get();

    let user;

    if (existing.length === 0) {
      // 新用户：创建记录
      const now = new Date();
      const defaultNickname = `玩家${OPENID.slice(-6)}`;
      const addRes = await usersCol.add({
        data: {
          _openid: OPENID,
          unionid: UNIONID || '',
          nickname: defaultNickname,
          avatar: '',
          phone: '',
          preferences: {
            categories: [],
            platforms: [],
          },
          status: 0,
          createdAt: now,
          updatedAt: now,
        },
      });
      user = {
        _id: addRes._id,
        _openid: OPENID,
        nickname: defaultNickname,
        avatar: '',
        isNew: true,
      };
    } else {
      // 老用户：更新 updatedAt
      user = existing[0];
      await usersCol.doc(user._id).update({
        data: { updatedAt: new Date() },
      });
      user.isNew = false;
    }

    return {
      code: 0,
      message: 'ok',
      data: {
        openid: OPENID,
        unionid: UNIONID || '',
        appid: APPID,
        user: {
          id: user._id,
          nickname: user.nickname,
          avatar: user.avatar,
          isNew: user.isNew,
        },
      },
    };
  } catch (err) {
    console.error('[login] error:', err);
    return {
      code: 5000,
      message: err.message || '登录失败',
      data: null,
    };
  }
};
