(function () {
  'use strict';

  var S = window.VisualizerSettings;
  var SOURCE_BANDS = S.SOURCE_BANDS;
  var WAVE_POINTS = S.WAVE_POINTS;
  var SPECTRUM_MIN = S.SPECTRUM_MIN;
  var SPECTRUM_MAX = S.SPECTRUM_MAX;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var elements = {
    previewCanvas: $('previewCanvas'),
    previewFrame: $('previewFrame'),
    previewIdleBadge: $('previewIdleBadge'),
    connectionPill: $('connectionPill'),
    connectionText: $('connectionText'),
    overlayText: $('overlayText'),
    portValue: $('portValue'),
    panelPort: $('panelPort'),
    overlayUrl: $('overlayUrl'),
    copyBtn: $('copyBtn'),
    openOverlayBtn: $('openOverlayBtn'),
    fullscreenBtn: $('fullscreenBtn'),
    captureDesktopBtn: $('captureDesktopBtn'),
    captureMicBtn: $('captureMicBtn'),
    demoBtn: $('demoBtn'),
    stopBtn: $('stopBtn'),
    captureState: document.querySelector('.capture-state'),
    captureStatusText: $('captureStatusText'),
    captureDot: $('captureDot'),
    fpsValue: $('fpsValue'),
    fpsBadge: $('fpsBadge'),
    levelBar: $('levelBar'),
    levelValue: $('levelValue'),
    presets: $('presets'),
    randomizeBtn: $('randomizeBtn'),
    resetBtn: $('resetBtn'),
    saveState: $('saveState'),
    toast: $('toast')
  };

  var settings = S.sanitize(S.DEFAULTS);
  var visualizer = new window.FrequencyVisualizer(elements.previewCanvas, settings).start();
  var settingInputs = Array.prototype.slice.call(
    document.querySelectorAll('[data-setting]')
  );
  var choiceGroups = Array.prototype.slice.call(
    document.querySelectorAll('[data-choice-group]')
  );
  var visibilityElements = Array.prototype.slice.call(
    document.querySelectorAll('[data-show-when]')
  );

  var captureSession = null;
  var frameInFlight = false;
  var eventSource = null;
  var connected = false;
  var hasLocalEdit = false;
  var saveTimer = null;
  var saveStateTimer = null;
  var saveSequence = 0;
  var toastTimer = null;
  var activePresetId = null;
  var levelUiAt = 0;
  var lastConnectionState = '';

  var PRESET_PRESERVE = [
    'alignX',
    'alignY',
    'areaWidth',
    'areaHeight',
    'opacity',
    'bgColor',
    'bgOpacity',
    'showStatus',
    'minFreq',
    'maxFreq',
    'scale',
    'sensitivity',
    'tilt',
    'noiseFloor'
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    if (typeof value !== 'number') return String(value);
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 100) / 100);
  }

  function normalizeHex(value) {
    var match = String(value).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;
    var digits = match[1];
    if (digits.length === 3) {
      digits = digits
        .split('')
        .map(function (part) {
          return part + part;
        })
        .join('');
    }
    return '#' + digits.toLowerCase();
  }

  function hslToHex(hue, saturation, lightness) {
    var h = ((hue % 360) + 360) % 360;
    var s = clamp(saturation, 0, 100) / 100;
    var l = clamp(lightness, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0;
    var g = 0;
    var b = 0;
    if (h < 60) {
      r = c;
      g = x;
    } else if (h < 120) {
      r = x;
      g = c;
    } else if (h < 180) {
      g = c;
      b = x;
    } else if (h < 240) {
      g = x;
      b = c;
    } else if (h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    function toHex(value) {
      var part = Math.round((value + m) * 255).toString(16);
      return part.length === 1 ? '0' + part : part;
    }
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function showToast(message, type) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle('is-error', type === 'error');
    elements.toast.classList.add('is-visible');
    toastTimer = window.setTimeout(function () {
      elements.toast.classList.remove('is-visible');
    }, type === 'error' ? 4800 : 2600);
  }

  function setConnection(state, text) {
    if (lastConnectionState === state + '|' + text) return;
    lastConnectionState = state + '|' + text;
    elements.connectionPill.dataset.state = state;
    elements.connectionText.textContent = text;
  }

  function setOverlayCount(count) {
    var safe = Math.max(0, Number(count) || 0);
    elements.overlayText.textContent = '叠加层 ' + safe;
  }

  function setPort(port) {
    var text = port ? String(port) : '—';
    elements.portValue.textContent = text;
    elements.panelPort.textContent = text;
  }

  function setSaveState(state) {
    var labels = {
      idle: '已同步',
      saving: '保存中…',
      saved: '已保存',
      error: '保存失败'
    };
    elements.saveState.dataset.state = state;
    elements.saveState.textContent = labels[state] || labels.idle;
    window.clearTimeout(saveStateTimer);
    if (state === 'saved') {
      saveStateTimer = window.setTimeout(function () {
        setSaveState('idle');
      }, 1800);
    }
  }

  function updateRangeFills() {
    document.querySelectorAll('input[type="range"][data-setting]').forEach(function (input) {
      var min = Number(input.min);
      var max = Number(input.max);
      var value = Number(input.value);
      var percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
      input.style.setProperty('--fill', clamp(percent, 0, 100).toFixed(2) + '%');
    });
  }

  function displayValue(key) {
    var value = settings[key];
    if (typeof value === 'string' && value.charAt(0) === '#') {
      return value.toUpperCase();
    }
    if (typeof value === 'number') return formatNumber(value);
    return String(value);
  }

  function refreshOutputs(force) {
    document.querySelectorAll('[data-output]').forEach(function (output) {
      var key = output.dataset.output;
      if (settings[key] === undefined) return;
      var text = displayValue(key);
      if (output.tagName === 'INPUT') {
        if (force === true || document.activeElement !== output) {
          output.value = text;
        }
      } else {
        output.textContent = text;
      }
    });
  }

  function syncValueUnits() {
    document.querySelectorAll('[data-unit-for]').forEach(function (unit) {
      var key = unit.dataset.unitFor;
      var range = document.querySelector(
        'input[type="range"][data-setting="' + key + '"]'
      );
      unit.textContent = range && range.dataset.suffix ? range.dataset.suffix : '';
    });
  }

  function normalizeFrequencyWindow(key) {
    if (key === 'minFreq' && settings.maxFreq < settings.minFreq * 1.1) {
      settings.maxFreq = Math.min(
        20000,
        Math.max(200, Math.round(settings.minFreq * 2))
      );
    } else if (key === 'maxFreq' && settings.minFreq > settings.maxFreq / 1.1) {
      settings.minFreq = Math.max(20, Math.round(settings.maxFreq / 2));
    }
  }

  function normalizeNumericValue(key, value) {
    var range = S.RANGES[key];
    var next = range ? clamp(value, range[0], range[1]) : value;
    var control = document.querySelector(
      'input[type="range"][data-setting="' + key + '"]'
    );
    var step = control ? Number(control.step) : 1;
    if (Number.isFinite(step) && step > 0) {
      next = Math.round(next / step) * step;
    }
    return Number(next.toFixed(4));
  }

  function markInvalid(input) {
    input.classList.add('is-invalid');
    window.setTimeout(function () {
      input.classList.remove('is-invalid');
    }, 900);
  }

  function commitOutputValue(input) {
    var key = input.dataset.output;
    var current = settings[key];
    var raw = input.value.trim();
    var next;

    if (typeof current === 'string' && current.charAt(0) === '#') {
      next = normalizeHex(raw);
      if (!next) {
        markInvalid(input);
        input.value = displayValue(key);
        showToast('请输入 6 位十六进制颜色，例如 #24FFC8', 'error');
        return;
      }
    } else {
      next = Number(raw);
      if (!raw || !Number.isFinite(next)) {
        markInvalid(input);
        input.value = displayValue(key);
        showToast('请输入有效数字', 'error');
        return;
      }
      next = normalizeNumericValue(key, next);
    }

    settings[key] = next;
    normalizeFrequencyWindow(key);
    commitLocalChange();
  }

  function bindOutputs() {
    document.querySelectorAll('input[data-output]').forEach(function (output) {
      output.addEventListener('focus', function () {
        output.select();
      });
      output.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          output.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          output.value = displayValue(output.dataset.output);
          output.blur();
        }
      });
      output.addEventListener('change', function () {
        commitOutputValue(output);
      });
    });
  }

  function updateVisibility() {
    visibilityElements.forEach(function (element) {
      var expression = element.dataset.showWhen || '';
      var separator = expression.indexOf(':');
      if (separator < 0) return;
      var key = expression.slice(0, separator);
      var allowed = expression.slice(separator + 1).split(',');
      var visible = allowed.indexOf(String(settings[key])) >= 0;
      element.hidden = !visible;
    });
  }

  function updateChoiceGroups() {
    choiceGroups.forEach(function (group) {
      var key = group.dataset.choiceGroup;
      group.querySelectorAll('button[data-value]').forEach(function (button) {
        button.classList.toggle('is-active', String(settings[key]) === button.dataset.value);
      });
    });
  }

  function syncControls() {
    settingInputs.forEach(function (input) {
      var key = input.dataset.setting;
      var value = settings[key];
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else if (input.type === 'number' || input.type === 'range') {
        input.value = value;
      } else {
        input.value = value;
      }
    });
    updateChoiceGroups();
    refreshOutputs();
    updateRangeFills();
    updateVisibility();
  }

  function markPreset(id) {
    activePresetId = id;
    elements.presets.querySelectorAll('.preset-card').forEach(function (card) {
      card.classList.toggle('is-active', card.dataset.presetId === id);
    });
  }

  function applySettings(next, options) {
    var opts = options || {};
    var sanitized = S.sanitize(next);
    var changed = JSON.stringify(sanitized) !== JSON.stringify(settings);
    settings = sanitized;
    visualizer.setSettings(settings);
    syncControls();
    if (changed && opts.remote) markPreset(null);
  }

  function commitLocalChange(options) {
    var opts = options || {};
    hasLocalEdit = true;
    visualizer.setSettings(settings);
    syncControls();
    if (opts.keepPreset !== true) markPreset(null);
    setSaveState('saving');
    scheduleSave();
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveSettings();
    }, 220);
  }

  function saveSettings() {
    var sequence = ++saveSequence;
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: settings })
    })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (sequence !== saveSequence) return;
        hasLocalEdit = false;
        setSaveState('saved');
        if (data && data.settings) {
          var served = S.sanitize(data.settings);
          if (JSON.stringify(served) !== JSON.stringify(settings)) {
            settings = served;
            visualizer.setSettings(settings);
            syncControls();
          }
        }
      })
      .catch(function (error) {
        if (sequence !== saveSequence) return;
        setSaveState('error');
        showToast('配置保存失败：' + error.message, 'error');
      });
  }

  function onSettingInput(event) {
    var input = event.currentTarget;
    var key = input.dataset.setting;
    var value;

    if (input.type === 'checkbox') {
      value = input.checked;
    } else if (input.type === 'range' || input.type === 'number') {
      value = Number(input.value);
      if (!Number.isFinite(value)) return;
    } else {
      value = input.value;
    }

    settings[key] = value;

    // Keep the frequency window sensible while the user drags.
    normalizeFrequencyWindow(key);

    commitLocalChange();
  }

  function bindControls() {
    settingInputs.forEach(function (input) {
      var eventName =
        input.type === 'range' || input.type === 'color' ? 'input' : 'change';
      input.addEventListener(eventName, onSettingInput);
    });

    choiceGroups.forEach(function (group) {
      group.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-value]');
        if (!button) return;
        var key = group.dataset.choiceGroup;
        var value = button.dataset.value;
        if (settings[key] === value) return;
        settings[key] = value;
        commitLocalChange();
      });
    });
  }

  function renderPresets() {
    elements.presets.textContent = '';
    S.PRESETS.forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset-card';
      button.dataset.presetId = preset.id;

      var swatch = document.createElement('span');
      swatch.className = 'preset-swatch';
      ['color1', 'color2', 'color3'].forEach(function (colorKey) {
        var segment = document.createElement('i');
        var color =
          (preset.settings && preset.settings[colorKey]) || S.DEFAULTS[colorKey];
        segment.style.setProperty('--swatch', color);
        swatch.appendChild(segment);
      });

      var name = document.createElement('strong');
      name.textContent = preset.name;
      var hint = document.createElement('small');
      hint.textContent = preset.hint;

      button.appendChild(swatch);
      button.appendChild(name);
      button.appendChild(hint);
      button.addEventListener('click', function () {
        applyPreset(preset.id);
      });
      elements.presets.appendChild(button);
    });
  }

  function applyPreset(id) {
    var preset = S.PRESETS.find(function (entry) {
      return entry.id === id;
    });
    if (!preset) return;

    var next = Object.assign({}, S.DEFAULTS);
    PRESET_PRESERVE.forEach(function (key) {
      next[key] = settings[key];
    });
    Object.assign(next, preset.settings);
    applySettings(next);
    markPreset(id);
    hasLocalEdit = true;
    setSaveState('saving');
    scheduleSave();
    showToast('已应用预设「' + preset.name + '」');
  }

  function randomizeTheme() {
    var baseHue = Math.random() * 360;
    var renderer = ['bars', 'bars', 'wave', 'radial'][Math.floor(Math.random() * 4)];
    var modes = ['gradient', 'gradient', 'rainbow', 'level', 'solid'];
    var colorMode = modes[Math.floor(Math.random() * modes.length)];

    var next = Object.assign({}, settings, {
      renderer: renderer,
      colorMode: colorMode,
      color1: hslToHex(baseHue, 86, 60),
      color2: hslToHex(baseHue + 42 + Math.random() * 28, 84, 61),
      color3: hslToHex(baseHue + 105 + Math.random() * 40, 82, 63),
      smoothing: Math.round(32 + Math.random() * 43),
      peakCaps: Math.random() > 0.15
    });

    if (renderer === 'wave') {
      next.lineWidth = Number((1.5 + Math.random() * 4).toFixed(1));
      next.waveScale = Math.round(70 + Math.random() * 65);
      next.waveFill = true;
    } else if (renderer === 'radial') {
      next.barCount = Math.round(76 + Math.random() * 76);
      next.gap = Math.round(16 + Math.random() * 40);
      next.innerRadius = Math.round(22 + Math.random() * 25);
      next.spinSpeed = Math.round(-12 + Math.random() * 29);
    } else {
      next.barCount = Math.round(48 + Math.random() * 68);
      next.gap = Math.round(10 + Math.random() * 42);
      next.round = Math.round(Math.random() * 90);
      next.mirrorX = Math.random() < 0.24;
      next.mirrorY = Math.random() < 0.1;
    }

    applySettings(next);
    markPreset(null);
    hasLocalEdit = true;
    setSaveState('saving');
    scheduleSave();
    showToast('已生成随机主题');
  }

  function resetToDefaults() {
    var confirmed = window.confirm('恢复所有视觉参数为默认值？当前自定义设置会被覆盖。');
    if (!confirmed) return;
    applySettings(S.DEFAULTS);
    markPreset(null);
    hasLocalEdit = true;
    setSaveState('saving');
    scheduleSave();
    showToast('已恢复默认设置');
  }

  function updateOverlayUrl() {
    elements.overlayUrl.value = new URL('/overlay.html', window.location.href).href;
  }

  async function copyOverlayUrl() {
    var value = elements.overlayUrl.value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('浏览器源地址已复制');
    } catch {
      elements.overlayUrl.focus();
      elements.overlayUrl.select();
      try {
        document.execCommand('copy');
        showToast('浏览器源地址已复制');
      } catch {
        showToast('复制失败，请手动选择地址复制', 'error');
      }
    }
  }

  function openOverlay() {
    window.open('/overlay.html', '_blank', 'noopener');
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await elements.previewFrame.requestFullscreen();
      }
    } catch {
      showToast('当前浏览器未允许全屏预览', 'error');
    }
  }

  function setLevel(rms) {
    var now = performance.now();
    if (now - levelUiAt < 75) return;
    levelUiAt = now;
    var percent = clamp(Math.round(Math.sqrt(clamp(rms, 0, 1)) * 175), 0, 100);
    elements.levelBar.style.width = percent + '%';
    elements.levelValue.textContent = percent + '%';
  }

  function clearLevel() {
    elements.levelBar.style.width = '0%';
    elements.levelValue.textContent = '0%';
  }

  function setCaptureState(state, text) {
    var active = state === 'active';
    var busy = state === 'starting';
    elements.captureDesktopBtn.disabled = active || busy;
    elements.captureMicBtn.disabled = active || busy;
    elements.demoBtn.disabled = active || busy;
    elements.stopBtn.disabled = !active;
    elements.captureStatusText.textContent = text;
    elements.captureState.classList.toggle('is-active', active);
    elements.captureState.classList.toggle('is-error', state === 'error');
    elements.previewFrame.classList.toggle('is-live', active);
    elements.previewIdleBadge.hidden = active || busy;
    if (!active) {
      clearLevel();
      elements.fpsValue.textContent = '—';
      elements.fpsBadge.classList.remove('is-low');
    }
  }

  async function stopCapture(message) {
    var session = captureSession;
    captureSession = null;
    if (!session) {
      setCaptureState('idle', message || '尚未开始采集');
      return;
    }

    stopSessionClock(session);
    if (session.stream) {
      session.stream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
    }
    if (session.source) {
      try {
        session.source.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (session.mute) {
      try {
        session.mute.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (session.audioContext) {
      try {
        await session.audioContext.close();
      } catch {
        /* ignore */
      }
    }

    setCaptureState('idle', message || (session.kind === 'demo' ? '演示已停止' : '已停止采集'));
  }

  function buildBandRanges(sampleRate, fftSize, count) {
    var binCount = fftSize / 2;
    var binHz = sampleRate / fftSize;
    var maxFreq = Math.min(SPECTRUM_MAX, sampleRate / 2);
    var ranges = [];
    for (var i = 0; i < count; i += 1) {
      var f0 = SPECTRUM_MIN * Math.pow(maxFreq / SPECTRUM_MIN, i / count);
      var f1 = SPECTRUM_MIN * Math.pow(maxFreq / SPECTRUM_MIN, (i + 1) / count);
      var start = Math.max(1, Math.floor(f0 / binHz));
      var end = Math.min(binCount - 1, Math.max(start, Math.ceil(f1 / binHz)));
      ranges.push([start, end]);
    }
    return ranges;
  }

  function roundArray(values, precision) {
    var factor = Math.pow(10, precision);
    var out = new Array(values.length);
    for (var i = 0; i < values.length; i += 1) {
      out[i] = Math.round(values[i] * factor) / factor;
    }
    return out;
  }

  function sendFrame(frame) {
    if (frameInFlight) return;
    frameInFlight = true;
    fetch('/api/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(frame)
    })
      .catch(function () {
        /* The overlay reconnects when the local server comes back. */
      })
      .then(function () {
        frameInFlight = false;
      });
  }

  function stopSessionClock(session) {
    if (!session) return;
    if (session.ticker) {
      try {
        session.ticker.postMessage({ type: 'stop' });
        session.ticker.terminate();
      } catch {
        /* ignore */
      }
      session.ticker = null;
    }
    if (session.fallbackTimer) {
      window.clearInterval(session.fallbackTimer);
      session.fallbackTimer = null;
    }
  }

  function startSessionClock(session, callback) {
    var usedFallback = false;

    function useFallback() {
      if (usedFallback) return;
      usedFallback = true;
      if (session.ticker) {
        try {
          session.ticker.terminate();
        } catch {
          /* ignore */
        }
        session.ticker = null;
      }
      session.fallbackTimer = window.setInterval(function () {
        if (captureSession === session) callback();
      }, 33);
    }

    try {
      if (typeof Worker === 'undefined') {
        useFallback();
        return;
      }
      var worker = new Worker('/ticker-worker.js');
      worker.onmessage = function (event) {
        if (captureSession !== session) return;
        if (event.data && event.data.type === 'tick') callback();
      };
      worker.onerror = function () {
        useFallback();
      };
      worker.postMessage({ type: 'start', interval: 33 });
      session.ticker = worker;
    } catch {
      useFallback();
    }
  }

  function updateFrameRate(session) {
    var now = performance.now();
    if (!session.fpsWindowStart) {
      session.fpsWindowStart = now;
      session.fpsFrames = 0;
      return;
    }
    session.fpsFrames += 1;
    var elapsed = now - session.fpsWindowStart;
    if (elapsed < 1000) return;

    var fps = Math.round((session.fpsFrames * 1000) / elapsed);
    session.fpsWindowStart = now;
    session.fpsFrames = 0;
    elements.fpsValue.textContent = String(fps);
    elements.fpsBadge.classList.toggle('is-low', fps < 8);
  }

  function tickAnalyzer(session) {
    if (captureSession !== session) return;
    var analyser = session.analyser;
    var freq = session.freq;
    var time = session.time;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(time);

    var bands = new Array(SOURCE_BANDS);
    for (var i = 0; i < SOURCE_BANDS; i += 1) {
      var range = session.bandRanges[i];
      var peak = 0;
      for (var b = range[0]; b <= range[1]; b += 1) {
        if (freq[b] > peak) peak = freq[b];
      }
      bands[i] = peak / 255;
    }

    var wave = new Array(WAVE_POINTS);
    var timeLength = time.length;
    for (var w = 0; w < WAVE_POINTS; w += 1) {
      var index = Math.round((w / (WAVE_POINTS - 1)) * (timeLength - 1));
      wave[w] = (time[index] - 128) / 128;
    }

    var sum = 0;
    var step = Math.max(1, Math.floor(timeLength / 512));
    var samples = 0;
    for (var s = 0; s < timeLength; s += step) {
      var normalized = (time[s] - 128) / 128;
      sum += normalized * normalized;
      samples += 1;
    }
    var rms = samples ? Math.sqrt(sum / samples) : 0;

    var frame = {
      bands: roundArray(bands, 3),
      wave: roundArray(wave, 3),
      rms: Math.round(rms * 1000) / 1000
    };

    visualizer.pushFrame(frame);
    sendFrame(frame);
    setLevel(rms);
    updateFrameRate(session);
  }

  async function startStreamSession(stream, kind) {
    setCaptureState('starting', '正在初始化音频分析…');
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('当前浏览器不支持 Web Audio API。');
    }

    if (!stream.getAudioTracks().length) {
      throw new Error('NO_AUDIO');
    }

    var audioContext = null;
    try {
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      await audioContext.resume();

      var source = audioContext.createMediaStreamSource(stream);
      var analyser = audioContext.createAnalyser();
      // A shorter FFT window and minimal analyser smoothing reduce latency.
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.15;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -20;
      source.connect(analyser);

      // A silent sink keeps the graph running without monitoring the audio.
      var mute = audioContext.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(audioContext.destination);

      var session = {
        kind: kind,
        stream: stream,
        audioContext: audioContext,
        source: source,
        analyser: analyser,
        mute: mute,
        freq: new Uint8Array(analyser.frequencyBinCount),
        time: new Uint8Array(analyser.fftSize),
        bandRanges: buildBandRanges(
          audioContext.sampleRate,
          analyser.fftSize,
          SOURCE_BANDS
        ),
        ticker: null,
        fallbackTimer: null,
        fpsWindowStart: 0,
        fpsFrames: 0
      };

      captureSession = session;

      stream.getTracks().forEach(function (track) {
        track.addEventListener('ended', function () {
          if (captureSession === session) {
            stopCapture('共享已结束');
          }
        });
      });

      startSessionClock(session, function () {
        tickAnalyzer(session);
      });

      setCaptureState(
        'active',
        kind === 'desktop' ? '桌面音频采集中' : '麦克风采集中'
      );
      tickAnalyzer(session);
      showToast(kind === 'desktop' ? '已开始采集桌面音频' : '已开始采集麦克风');
    } catch (error) {
      stream.getTracks().forEach(function (track) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      });
      if (audioContext) {
        try {
          await audioContext.close();
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  }

  function captureErrorMessage(error) {
    if (!error) return '采集失败，请重试。';
    if (error.message === 'NO_AUDIO') {
      return '没有获得音频。请选择「整个屏幕」并勾选「分享系统音频」。';
    }
    if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
      return '已取消共享，或浏览器没有授予音频采集权限。';
    }
    if (error.name === 'NotFoundError') {
      return '没有找到可用的音频设备。';
    }
    if (error.name === 'NotSupportedError') {
      return '当前浏览器不支持该采集方式，请使用最新版 Chrome 或 Edge。';
    }
    if (error.name === 'NotReadableError') {
      return '音频设备被占用或无法读取，请关闭其他占用设备的程序后重试。';
    }
    return error.message || '采集失败，请重试。';
  }

  async function startDesktopCapture() {
    if (captureSession) await stopCapture('已切换采集源');
    if (!window.isSecureContext) {
      setCaptureState('error', '需要通过 localhost 打开');
      showToast('桌面音频只能在 http://127.0.0.1 或 localhost 下采集。', 'error');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setCaptureState('error', '当前浏览器不支持桌面采集');
      showToast('请使用最新版 Chrome / Edge 打开本页。', 'error');
      return;
    }

    setCaptureState('starting', '请选择要共享的屏幕或窗口…');
    try {
      var stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        throw new Error('NO_AUDIO');
      }
      await startStreamSession(stream, 'desktop');
    } catch (error) {
      setCaptureState('error', '未能采集桌面音频');
      showToast(captureErrorMessage(error), 'error');
    }
  }

  async function startMicrophoneCapture() {
    if (captureSession) await stopCapture('已切换采集源');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCaptureState('error', '当前浏览器不支持麦克风');
      showToast('请使用最新版 Chrome / Edge 打开本页。', 'error');
      return;
    }

    setCaptureState('starting', '正在请求麦克风权限…');
    try {
      var stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      await startStreamSession(stream, 'mic');
    } catch (error) {
      setCaptureState('error', '未能采集麦克风');
      showToast(captureErrorMessage(error), 'error');
    }
  }

  async function startDemo() {
    if (captureSession) await stopCapture('已切换采集源');
    var session = {
      kind: 'demo',
      ticker: null,
      fallbackTimer: null,
      startedAt: performance.now(),
      fpsWindowStart: 0,
      fpsFrames: 0
    };
    captureSession = session;
    startSessionClock(session, function () {
      if (captureSession !== session) return;
      var frame = window.DemoSignal.createFrame(
        (performance.now() - session.startedAt) / 1000
      );
      visualizer.pushFrame(frame);
      sendFrame(frame);
      setLevel(frame.rms);
      updateFrameRate(session);
    });
    setCaptureState('active', '演示信号播放中');
    showToast('演示模式已启动，叠加层会同步显示（不包含真实音频）');
  }

  async function loadConfig() {
    try {
      var response = await fetch('/api/config', { cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      var data = await response.json();
      if (data && data.port) setPort(data.port);
      if (!hasLocalEdit && data && data.settings) {
        applySettings(data.settings, { remote: true });
      }
    } catch (error) {
      showToast('无法读取服务端配置：' + error.message, 'error');
    }
  }

  function connectEvents() {
    if (!window.EventSource) {
      setConnection('error', '浏览器不支持 SSE');
      return;
    }

    eventSource = new EventSource('/api/events?role=control');

    eventSource.addEventListener('open', function () {
      connected = true;
      setConnection('online', '本地服务已连接');
    });

    eventSource.addEventListener('error', function () {
      connected = false;
      setConnection('error', '正在重连服务…');
    });

    eventSource.addEventListener('hello', function (event) {
      connected = true;
      setConnection('online', '本地服务已连接');
      try {
        var data = JSON.parse(event.data);
        setOverlayCount(data.overlayClients);
        if (!hasLocalEdit && data.settings) {
          applySettings(data.settings, { remote: true });
        }
      } catch (error) {
        console.warn('[音频可视化] 无法解析 hello 事件', error);
      }
    });

    eventSource.addEventListener('status', function (event) {
      try {
        var data = JSON.parse(event.data);
        setOverlayCount(data.overlayClients);
      } catch (error) {
        /* ignore bad status payloads */
      }
    });

    eventSource.addEventListener('config', function (event) {
      try {
        var data = JSON.parse(event.data);
        if (!hasLocalEdit && data && data.settings) {
          applySettings(data.settings, { remote: true });
        }
      } catch (error) {
        console.warn('[音频可视化] 无法解析 config 事件', error);
      }
    });
  }

  function bindActions() {
    elements.captureDesktopBtn.addEventListener('click', startDesktopCapture);
    elements.captureMicBtn.addEventListener('click', startMicrophoneCapture);
    elements.demoBtn.addEventListener('click', startDemo);
    elements.stopBtn.addEventListener('click', function () {
      stopCapture();
    });
    elements.copyBtn.addEventListener('click', copyOverlayUrl);
    elements.openOverlayBtn.addEventListener('click', openOverlay);
    elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
    elements.randomizeBtn.addEventListener('click', randomizeTheme);
    elements.resetBtn.addEventListener('click', resetToDefaults);
    elements.overlayUrl.addEventListener('focus', function () {
      elements.overlayUrl.select();
    });
  }

  function init() {
    updateOverlayUrl();
    setPort(window.location.port || '80');
    renderPresets();
    syncValueUnits();
    bindOutputs();
    bindControls();
    bindActions();
    syncControls();
    setCaptureState('idle', '尚未开始采集');
    setConnection('connecting', '连接中');

    var portFromLocation = window.location.port;
    if (portFromLocation) setPort(portFromLocation);

    loadConfig();
    connectEvents();
  }

  init();
})();
