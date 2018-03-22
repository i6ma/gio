function Courier(opts) {
  if (opts.target) {
    msgTarget = opts.target;
  }
}
Courier.on = addListener;
Courier.send = sender;
Courier.post = poster;



function addListener(path, func) {
  (msgListeners[path] || (msgListeners[path] = [])).push(func);
}



function sender(path, data, func) {
  poster(0, 0, {
    path: path,
    data: data,
    qid: regCallback(func)
  });
}

function poster(target, origin, message) {
  (target || msgTarget).postMessage(message, origin);
}



function regCallback(func) {
  if (!func) { return; }
  msgIndex += 1;
  msgCallbacks[msgIndex] = {
    func: func,
    time: +new Date,
    idx: msgIndex
  };
  !idxLookback && (idxLookback = msgIndex);
  return msgIndex;
}



function brushCallback(pid, data) {
  var now = +new Date;
  var reg = msgCallbacks[pid];
  if (now - reg.time <= idxTimeout) {
    reg.func(data);
  }
  delete msgCallbacks[pid];
  if (msgIndex < idxLookback + idxQueueout) {
    return;
  }
  for (var i = idxLookback; i < msgIndex; i++) {
    if (i in msgCallbacks) {
      var reg = msgCallbacks[i];
      if (now - reg.time > idxTimeout) {
        delete msgCallbacks[i];
        idxLookback = i + 1;
      } else {
        break;
      }
    } else {
      idxLookback = i + 1;
    }
  }
}


window.addEventListener('message', function (evt) {
  if (evt.origin.indexOf('://') < 0) { return; }
  var req   = evt.data;
  var pid   = req.pid;
  var path  = req.path;
  if (pid && msgCallbacks[pid]) {
    brushCallback(pid, req.data);
  } else if (path && msgListeners[path]) {
    var listeners = msgListeners[path];
    var res     = getPfunc(req);
    req.source  = evt.source;
    req.origin  = evt.origin;
    for (var i  = 0; i < listeners.length; i++) {
      listeners[i](req, res);
    }
  }
});



function getPfunc(req) {
  return !req.qid ? req.qid : function (data) {
    poster(req.source, req.origin, {
      pid: req.qid,
      data: data
    });
  };
}
