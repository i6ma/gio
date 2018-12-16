
/*
 * 基于 postMessage 跨域消息通道
 */

function imessage(opts) {

var foo         = new Function;
var ppState     = 0;                                        // 连接状态，ping-pong 状态
var ppTimer     = 0;                                        // ping 超时定时器
var mIndex      = 0;                                        // 自增消息 ID
var lookBack    = 0;                                        // 清理回调序列时的回顾起点，考虑频发消息的情况
var lookTime    = 0;                                        // 前一次清理回调序列的时间，考虑偶发消息的情况
var mStock      = [];                                       // 连接前收到的消息压入库存
var sListeners  = {};                                       // 系统级消息订阅者
var mListeners  = {};                                       // path 分类的消息订阅者
var mCallbacks  = {};                                       // 按消息 id 记录回调信息
var rootPath    = '/';                                      // 系统级消息专用 path
var mPing       = '/ping';                                  // 主动握手消息
var mPong       = '/pong';                                  // 应答握手消息
var tOrigin     = ['*'];                                    // 源校验，字符串则精确比对，数组则模式匹配
var mSource     = window;                                   // 当前收发消息的宿主
var mTarget     = mSource.opener || mSource.parent;         // 收发消息的目标宿主
var custPong    = ppCheck;                                  // 验证 ping-pong 消息并作出回应



function addListener(path, func, maps) {                    // 按 path 分类订阅消息
  path = fixPath(path);                                     // path 必须以 / 开头，以避免冲突保持一致
  maps = maps || mListeners;
  func && (maps[path] || (maps[path] = [])).push(func);
}


function offListener(path, func, maps) {                    // 剔除指定 path 分类下的指定(或全部)订阅
  path = fixPath(path);
  maps = maps || mListeners;
  if (!func) {                                              // 小心：不指定 func 则全部退订
    delete maps[path];
  } else {
    var list = maps[path] || [];
    for (var i = list.length; i--;) {                       // 逆向遍历以便剔除重复的订阅
      list[i] === func && list.splice(i, 1);
} } }



function sendMessage(path, data, func) {
  if (!ppState) {                                           // 连接前将消息压入库存
    mStock.push([path, data, func]);
  } else if (ppState < 0) {
    logError(path, data, func);
  } else {
    poster({
      path: fixPath(path),
      data: data || '',
      rqid: getRqid(func)                                   // 生成消息 id 并记录回调信息
    });
} }



function msgListener(evt) {                                 // 统一分检各种消息
  console.log(location.origin, +new Date, evt.origin);
  console.log(evt.data);
  if (!ppState || evt.origin === tOrigin) {                 // 消息源精确比对通过，或者连接尚未建立
    var req     = evt.data || {};
    var rqid    = req.rqid;
    var path    = req.path;
    req.source  = evt.source;
    req.origin  = evt.origin;
    if (ppState) {                                          // 连接之后才允许回执模式
      if (mCallbacks[rqid]) {                               // 按消息 id 找到了回调信息
        brushCalls(rqid, req);                              // 则按回执模式处理并清理回调信息
      } else {                                              // 否则发出 path 事件能和
        msgEmitter(path, req);
      }
    }
    if (path === rootPath) {                                // 系统级消息特殊处理
      msgEmitter(req.data.type || req.data, req, sListeners);
} } }



function msgEmitter(path, req, maps) {
  maps = maps || mListeners;
  var list = maps[path] || [];
  for (var i = 0; i < list.length; i++) {
    tryCall(list[i], [req.data, req, resCallback(req)]);    // 防止某个订阅错误累及其它订阅
} }


function poster(message, target, origin) {                  // postMessage API 必须指定宿主，origin 可以为 *
  (target || mTarget).postMessage(message || '', origin || tOrigin);
}

function fixPath(path) {                                    // path 必须以 / 开头，避免与对象属性冲突
  return ((path || '').charAt(0) === rootPath ? '' : rootPath) + path;
}

function logError() {
  console.error.apply(console, arguments);
}

function isFunction(val) {
  return typeof val === 'function';
}

function tryCall(func, args, errc) {
  try {
    func.apply(func, args);
  } catch (e) {
    (errc || logError)(e);
  }
}



function getRqid(func) {                                    // 为回调函数分配消息 id 并记录回调信息
  return !func ? 0 : (                                      // 发送者不指定回调时，需按往复模式处理
    mCallbacks[++mIndex] = {                                // 通过消息 id 查找发送者的回调信息
      func: func,
      time: +new Date,                                      // 用于超时检测
      rqid: mIndex                                          // 回复消息携带此 id 即可从 mCallbacks 中找到发送者信息
    },
    mIndex
  );
}

function resCallback(req) {                                 // 针对消息生成回执函数，即回复一条相同 id 的消息
  return !req.rqid ? foo : function (data) {                // 当订阅者调用此回执函数时，发送者的回调将被执行
    poster({                                                // 同一消息有多个订阅时，仅响应第一个回执
      rqid: req.rqid,                                       // 如果长时间不回执，发送者回调信息将被超时清理
      data: data
    }, req.source, req.origin);                             // 精确指定接收者，让消息沿原路回复
  };
}



function brushCalls(rqid, req) {                            // 执行并清理消息回调
  tryCall(mCallbacks[rqid].func, [req.data, req]);          // 以免回调出错影响后继逻辑，一条消息只响应一次回执
  delete mCallbacks[rqid];                                  // 处理首个回执后，立即删除相应的回调信息
  var now = +new Date;                                      // 下面处理等待回执超时的回调信息，以免内存泄漏
  if (mIndex > lookBack + 99 || now > lookTime + 6e4) {     // 每隔一定时间或者一定数量的消息
    lookTime = now;                                         // 就执行一次回调序列的清理
    for (var i = lookBack; i < mIndex; i++) {               // 不用数组而用 k-v 便于检索，要小心维护 id key
      lookBack = i + 1;                                     // 已经清理过的 key 后续不必再关注
      if (i in mCallbacks) {                                // 发送消息的 id 是连续的，但回执却不然
        if (now - mCallbacks[i].time < 6e4) {               // 发现首个未超时的回调，不必再继续检查
          lookBack = i;                                     // 标记下次清理的回顾起点为当前 id
          break;
        }
        delete mCallbacks[i];                               // 删除已超时的回调信息，解除引用回调函数
} } } }



function originLike(origin, likes) {                        // 简单的模式匹配，用 origin 验证消息来源
  !likes.pop && (likes = [likes]);
  for (var i = likes.length; i--;) {
    var like = likes[i];
    if (typeof like === 'string') {                         // 处理 `*.com` 这样的简单模式写法
      like = like.replace(/\./g, '\\.').replace(/\*/g, '.*?');
      likes[i] = like = new RegExp('^' + like + '$');
    }
    if (like.test(origin)) { return like; }
} }



function pingPong() {                                       // 发出 ping 消息
  ppTimer = ppTimer || setTimeout(function () {             // 不要求 ping-pong 消息成对，但任意 ping 超时都认定为失联
    ppState >= 0 && logError(mPing);                        // 相应的任意 pong 通过验证即清除 ping 超时
    setState(-1);
  }, 99);
  poster({
    path: rootPath,                                         // 系统级消息专用 path，连接前不能使用回执模式
    data: mPing                                             // 连接后也应该使用往复模式，以免占用回调信息空间
  }, mTarget, ppState ? tOrigin : '*');                     // 未连接前泛发 ping 并在收到 pong 后校验 origin
}


function ppCheck(data, req) {                               // 验证 ping-pong 消息的 origin 并作出回应
  var checked;
  if (ppState) {                                            // 无论是否连接，默认 ping 消息都不支持回执模式
    checked = req.origin === tOrigin;                       // 连接后对 origin 执行精确比对，连接前则按模式匹配
  } else {
    checked = req.source !== mSource && originLike(req.origin, tOrigin);
    checked && setState(1, req);                            // 认可消息源，确认连接，注意避免自问自答
  }
  if (checked) {                                            // 主动的 ping 收到可验证的 pong 或者直接收到可验证的 ping，都认定为连接
    data === mPing && sendMessage(rootPath, mPong);         // 对通过验证的 ping 回复 pong
    clearTimeout(ppTimer);                                  // 任意 pong 通过验证即清除 ping 超时
    ppTimer = 0;                                            // 或者收到可验证的 ping 也清除自身的 ping 超时
  }
}



function setState(state, req) {                             // 连接状态切换并记录连接目标
  if (!(ppState > 0 && state > 0)) {                        // 状态从正数变成正数无需处理
    if (state < 0) {                                        // 连接超时或其它失败
      mListeners = {};                                      // 清空订阅信息
      mCallbacks = {};                                      // 清空回调信息
    } else if (req) {                                       // origin 验证通过后，记录目标供后续使用
      mTarget = req.source || mTarget;
      tOrigin = req.origin || tOrigin;
    }
  }
  if (ppState !== state) {
    aboutState(ppState = state);                            // 状态改变时尝试发出通知
    var list = mStock.slice();                              // 创建副本以免调用 sendMessage 时发生无限 push
    mStock = [];
    for (var i = 0; i < list.length; i++) {
      sendMessage.apply(sendMessage, list[i]);
} } }


function aboutState(arg) {                                  // 获取当前状态，或者注意状态监听
  if (isFunction(arg)) {
    aboutState._cf = arg;
  } else if (isFinite(arg)) {
    tryCall(aboutState._cf, [arg], foo);
  }
  return ppState;
}


function setTarget(val) {
  return mTarget = val || mTarget;
}


function setOrigin(val) {
  val && (tOrigin = val.pop ? val : [val]);
  return tOrigin;
}


function setPong(val) {                                     // 注册 pong 函数，用于接收 ping 消息并决定回复 pong
  if (val !== custPong) {
    offListener(mPing, custPong, sListeners);
    !isFunction(custPong = val) && (custPong = ppCheck);
    addListener(mPing, custPong, sListeners);
  }
  return custPong;
}


function setOptions(opts) {
  setTarget(opts.target);
  setOrigin(opts.origin);
  setPong(opts.pong);                                       // 可依据已设置的 origin 自动回应 pong
  addListener(mPong, ppCheck, sListeners);                  // 因为 pong 已经是对 ping 的回应，可以认定为连接确认
  if (!opts.pong && mSource !== mSource.parent) {           // 未设置 pong 选项，且可能处于 iframe 内时，发出初始 ping
    pingPong();                                             // 预期 parent 已经准备好回复 pong 以便建立连接
  }
}



mSource.addEventListener('message', msgListener);
setOptions(opts || {});



return {
  on: addListener,
  off: offListener,
  send: sendMessage,
  state: aboutState,
  target: setTarget,
  origin: setOrigin,
  pong: setPong,
  version: '1.1.1'
};

}


