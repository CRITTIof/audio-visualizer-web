(function () {
  'use strict';

  var S = window.VisualizerSettings;
  var canvas = document.getElementById('overlayCanvas');
  var statusEl = document.getElementById('overlayStatus');
  var statusText = document.getElementById('overlayStatusText');
  var query = new URLSearchParams(window.location.search);
  var demoMode = query.get('demo') === '1' || query.has('demo');

  var settings = S.sanitize(S.DEFAULTS);
  var visualizer = new window.FrequencyVisualizer(canvas, settings).start();
  var connected = false;
  var lastFrameAt = 0;
  var demoStartedAt = performance.now();
  var demoLastTick = 0;

  function applySettings(next) {
    settings = S.sanitize(next);
    visualizer.setSettings(settings);
    updateStatus();
  }

  function hasRecentFrame() {
    return demoMode || Date.now() - lastFrameAt < 1200;
  }

  function updateStatus() {
    var active = hasRecentFrame();
    document.documentElement.classList.toggle('is-live', active);

    if (!settings.showStatus) {
      statusEl.hidden = true;
      return;
    }

    statusEl.hidden = active;
    if (!active) {
      statusText.textContent = connected ? '等待桌面音频…' : '正在连接本地服务…';
    }
  }

  function handleFrame(frame) {
    visualizer.pushFrame(frame);
    lastFrameAt = Date.now();
    updateStatus();
  }

  function beginDemo() {
    connected = true;
    function loop() {
      if (!demoMode) return;
      var now = performance.now();
      if (now - demoLastTick >= 30) {
        demoLastTick = now;
        try {
          handleFrame(window.DemoSignal.createFrame((now - demoStartedAt) / 1000));
        } catch (error) {
          console.warn('[音频可视化] 演示信号生成失败', error);
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function connect() {
    if (!window.EventSource) {
      connected = false;
      updateStatus();
      return;
    }

    var source = new EventSource('/api/events?role=overlay');

    source.addEventListener('open', function () {
      connected = true;
      updateStatus();
    });

    source.addEventListener('error', function () {
      connected = false;
      updateStatus();
    });

    source.addEventListener('hello', function (event) {
      connected = true;
      try {
        var data = JSON.parse(event.data);
        if (data && data.settings) applySettings(data.settings);
      } catch (error) {
        console.warn('[音频可视化] 无法解析服务端配置', error);
      }
      updateStatus();
    });

    source.addEventListener('config', function (event) {
      try {
        var data = JSON.parse(event.data);
        if (data && data.settings) applySettings(data.settings);
      } catch (error) {
        console.warn('[音频可视化] 无法解析配置更新', error);
      }
    });

    source.addEventListener('frame', function (event) {
      try {
        var frame = JSON.parse(event.data);
        if (frame && frame.bands) handleFrame(frame);
      } catch (error) {
        console.warn('[音频可视化] 无法解析频谱帧', error);
      }
    });
  }

  applySettings(settings);

  if (demoMode) {
    statusText.textContent = '演示模式';
    beginDemo();
  } else {
    connect();
  }

  window.setInterval(updateStatus, 500);

  // The overlay must not interfere with the browser source or the page below.
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    }
  });
})();
