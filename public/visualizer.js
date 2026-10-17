/*
 * FrequencyVisualizer
 * A dependency-free canvas renderer shared by the capture console preview and
 * the transparent browser-source overlay.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var SPECTRUM_MIN = 20;
  var SPECTRUM_MAX = 20000;
  var WAVE_POINTS = 256;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToRgb(hex) {
    var match = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!match) return { r: 255, g: 255, b: 255 };
    var raw = parseInt(match[1], 16);
    return { r: (raw >> 16) & 255, g: (raw >> 8) & 255, b: raw & 255 };
  }

  function rgba(hex, alpha) {
    var rgb = hexToRgb(hex);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function mixRgb(a, b, amount) {
    var ca = hexToRgb(a);
    var cb = hexToRgb(b);
    var t = clamp(amount, 0, 1);
    return (
      'rgb(' +
      Math.round(ca.r + (cb.r - ca.r) * t) +
      ',' +
      Math.round(ca.g + (cb.g - ca.g) * t) +
      ',' +
      Math.round(ca.b + (cb.b - ca.b) * t) +
      ')'
    );
  }

  function hueOf(hex) {
    var rgb = hexToRgb(hex);
    var r = rgb.r / 255;
    var g = rgb.g / 255;
    var b = rgb.b / 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;
    if (delta === 0) return 0;
    var hue;
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    return hue < 0 ? hue + 360 : hue;
  }

  function hsl(hue, saturation, lightness) {
    var h = ((hue % 360) + 360) % 360;
    return 'hsl(' + h + ',' + saturation + '%,' + lightness + '%)';
  }

  function roundRectPath(ctx, x, y, width, height, radius) {
    var r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    if (r < 0.1) {
      ctx.rect(x, y, width, height);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function resampleLinear(source, count) {
    var out = new Float32Array(count);
    if (!source || !source.length) return out;
    if (source.length === 1) {
      out.fill(source[0]);
      return out;
    }
    for (var i = 0; i < count; i += 1) {
      var pos = (i / (count - 1)) * (source.length - 1);
      var left = Math.floor(pos);
      var right = Math.min(source.length - 1, left + 1);
      var fraction = pos - left;
      out[i] = source[left] + (source[right] - source[left]) * fraction;
    }
    return out;
  }

  class FrequencyVisualizer {
    constructor(canvas, settings) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      if (!this.ctx) throw new Error('当前环境不支持 Canvas 2D。');

      this.settings = settings;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;

      this._values = new Float32Array(0);
      this._peaks = new Float32Array(0);
      this._waveValues = new Float32Array(WAVE_POINTS);
      this._bands = null;
      this._wave = null;
      this._lastFrameAt = 0;
      this._lastTickAt = 0;
      this._angle = 0;
      this._activeCount = 0;
      this._raf = null;
      this._running = false;

      this._handleResize = this._handleResize.bind(this);
      this._tick = this._tick.bind(this);
      window.addEventListener('resize', this._handleResize);

      if (typeof ResizeObserver !== 'undefined') {
        this._observer = new ResizeObserver(this._handleResize);
        this._observer.observe(canvas.parentElement || canvas);
      }

      this.resize();
      this.setSettings(settings);
    }

    _handleResize() {
      this.resize();
    }

    resize() {
      var rect = this.canvas.getBoundingClientRect();
      var width = Math.max(1, Math.round(rect.width));
      var height = Math.max(1, Math.round(rect.height));
      var dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
      var pixelWidth = Math.round(width * dpr);
      var pixelHeight = Math.round(height * dpr);

      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }

      this.width = width;
      this.height = height;
      this.dpr = dpr;
    }

    setSettings(settings) {
      this.settings = settings;
      var useMirrorX = settings.renderer === 'bars' && settings.mirrorX;
      var nextCount = useMirrorX
        ? Math.ceil(settings.barCount / 2)
        : settings.barCount;

      if (nextCount !== this._activeCount) {
        var oldValues = this._values;
        var oldPeaks = this._peaks;
        var values = new Float32Array(nextCount);
        var peaks = new Float32Array(nextCount);
        var carry = Math.min(nextCount, oldValues.length);
        if (carry > 0) {
          values.set(oldValues.subarray(0, carry));
          peaks.set(oldPeaks.subarray(0, carry));
        }
        this._values = values;
        this._peaks = peaks;
        this._activeCount = nextCount;
      }
    }

    pushFrame(frame) {
      if (!frame || !Array.isArray(frame.bands) || !frame.bands.length) return;
      var bands = new Float32Array(frame.bands.length);
      for (var i = 0; i < frame.bands.length; i += 1) {
        bands[i] = clamp(Number(frame.bands[i]) || 0, 0, 1);
      }
      var wave = Array.isArray(frame.wave) ? frame.wave : [];
      var waveValues = new Float32Array(wave.length);
      for (var j = 0; j < wave.length; j += 1) {
        waveValues[j] = clamp(Number(wave[j]) || 0, -1.5, 1.5);
      }
      this._bands = bands;
      this._wave = waveValues;
      this._lastFrameAt = performance.now();
    }

    start() {
      if (this._running) return this;
      this._running = true;
      this._lastTickAt = 0;
      this._raf = requestAnimationFrame(this._tick);
      return this;
    }

    stop() {
      this._running = false;
      if (this._raf !== null) cancelAnimationFrame(this._raf);
      this._raf = null;
      return this;
    }

    destroy() {
      this.stop();
      window.removeEventListener('resize', this._handleResize);
      if (this._observer) this._observer.disconnect();
    }

    _tick(now) {
      if (!this._running) return;
      var dt = this._lastTickAt
        ? clamp((now - this._lastTickAt) / 1000, 0.001, 0.1)
        : 1 / 60;
      this._lastTickAt = now;
      this._animate(dt, now / 1000);
      this._draw(now / 1000);
      this._raf = requestAnimationFrame(this._tick);
    }

    _animate(dt, time) {
      var cfg = this.settings;
      var count = this._activeCount;
      if (!count) return;

      var fresh =
        this._bands && performance.now() - this._lastFrameAt < 700;
      var noise = cfg.noiseFloor / 100;
      var smooth = cfg.smoothing / 100;
      var attackTau = 0.004 + smooth * 0.02;
      var releaseTau = 0.025 + smooth * 0.38;
      var minFreq = Math.max(SPECTRUM_MIN, cfg.minFreq);
      var maxFreq = Math.min(SPECTRUM_MAX, Math.max(minFreq * 1.1, cfg.maxFreq));
      var logMin = Math.log(SPECTRUM_MIN);
      var logRange = Math.log(SPECTRUM_MAX) - logMin;
      var fallRate = cfg.peakFall / 100;
      var staleFor = performance.now() - this._lastFrameAt;

      // Once the capture has been gone for a moment, snap to a truly blank
      // canvas so the browser-source layer is fully transparent again.
      if (!fresh && this._lastFrameAt && staleFor > 1600) {
        this._values.fill(0);
        this._peaks.fill(0);
        this._waveValues.fill(0);
      }

      for (var i = 0; i < count; i += 1) {
        var target = 0;

        if (fresh) {
          var t = count > 1 ? i / (count - 1) : 0;
          var frequency =
            cfg.scale === 'linear'
              ? minFreq + (maxFreq - minFreq) * t
              : minFreq * Math.pow(maxFreq / minFreq, t);
          var sourcePos = clamp((Math.log(frequency) - logMin) / logRange, 0, 1);
          var bandPos = sourcePos * (this._bands.length - 1);
          var left = Math.floor(bandPos);
          var right = Math.min(this._bands.length - 1, left + 1);
          var fraction = bandPos - left;
          var value =
            this._bands[left] +
            (this._bands[right] - this._bands[left]) * fraction;

          value = Math.max(0, (value - noise) / Math.max(0.001, 1 - noise));
          value *= cfg.sensitivity;
          value *= 1 + cfg.tilt * t;
          target = clamp(value, 0, 1);
        }

        var current = this._values[i];
        var tau = target > current ? attackTau : releaseTau;
        var alpha = 1 - Math.exp(-dt / tau);
        current += (target - current) * alpha;
        if (current < 0.0004) current = 0;
        this._values[i] = current;

        if (current >= this._peaks[i]) {
          this._peaks[i] = current;
        } else {
          this._peaks[i] = Math.max(0, this._peaks[i] - fallRate * dt);
        }
      }

      this._animateWave(dt, fresh);
      this._angle += (cfg.spinSpeed * Math.PI * dt) / 180;
    }

    _animateWave(dt, fresh) {
      var wave = this._waveValues;
      var source = fresh ? this._wave : null;
      var target = resampleLinear(source, WAVE_POINTS);
      var smooth = this.settings.smoothing / 100;
      var tau = 0.015 + smooth * 0.1;
      var alpha = 1 - Math.exp(-dt / tau);
      for (var i = 0; i < WAVE_POINTS; i += 1) {
        wave[i] += (target[i] - wave[i]) * alpha;
      }
    }

    _draw(time) {
      this.resize();
      var ctx = this.ctx;
      var cfg = this.settings;
      var width = this.width;
      var height = this.height;

      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      if (cfg.bgOpacity > 0) {
        ctx.fillStyle = rgba(cfg.bgColor, cfg.bgOpacity / 100);
        ctx.fillRect(0, 0, width, height);
      }

      var area = this._getArea(width, height);
      if (area.w < 1 || area.h < 1) return;

      ctx.save();
      ctx.globalAlpha = cfg.opacity / 100;

      if (cfg.renderer === 'wave') {
        this._drawWave(ctx, area, time);
      } else if (cfg.renderer === 'radial') {
        this._drawRadial(ctx, area, time);
      } else {
        this._drawBars(ctx, area, time);
      }

      ctx.restore();
    }

    _getArea(width, height) {
      var cfg = this.settings;
      var w = (width * cfg.areaWidth) / 100;
      var h = (height * cfg.areaHeight) / 100;
      var x = cfg.alignX === 'left' ? 0 : cfg.alignX === 'right' ? width - w : (width - w) / 2;
      var y =
        cfg.alignY === 'top'
          ? 0
          : cfg.alignY === 'bottom'
            ? height - h
            : (height - h) / 2;
      return { x: x, y: y, w: w, h: h, cx: x + w / 2, cy: y + h / 2 };
    }

    _barGradient(ctx, top, bottom) {
      var cfg = this.settings;
      var gradient = ctx.createLinearGradient(0, bottom, 0, top);
      gradient.addColorStop(0, cfg.color1);
      gradient.addColorStop(0.52, cfg.color2);
      gradient.addColorStop(1, cfg.color3);
      return gradient;
    }

    _glowColor(time) {
      var cfg = this.settings;
      if (cfg.colorMode === 'solid') return cfg.color1;
      if (cfg.colorMode === 'level') return cfg.color2;
      if (cfg.colorMode === 'rainbow') {
        return hsl(hueOf(cfg.color1) + time * cfg.hueDrift, cfg.rainbowSaturation, cfg.rainbowLightness);
      }
      return cfg.color2;
    }

    _barColor(index, t, value, time) {
      var cfg = this.settings;
      if (cfg.colorMode === 'solid') return cfg.color1;
      if (cfg.colorMode === 'rainbow') {
        var hue = hueOf(cfg.color1) + t * 260 + time * cfg.hueDrift;
        return hsl(hue, cfg.rainbowSaturation, cfg.rainbowLightness);
      }
      if (cfg.colorMode === 'level') {
        return value < 0.5
          ? mixRgb(cfg.color1, cfg.color2, value * 2)
          : mixRgb(cfg.color2, cfg.color3, (value - 0.5) * 2);
      }
      return cfg.color1;
    }

    _drawBars(ctx, area, time) {
      var cfg = this.settings;
      var count = this._activeCount;
      if (!count) return;

      var useMirrorX = cfg.mirrorX;
      var barWidth = useMirrorX ? area.w / (2 * count) : area.w / count;
      if (barWidth <= 0) return;

      var width = Math.max(0.7, barWidth * (1 - cfg.gap / 100));
      var baseY = cfg.mirrorY ? area.cy : area.y + area.h;
      var maxHeight = cfg.mirrorY ? area.h / 2 : area.h;
      var useGradient = cfg.colorMode === 'gradient';
      var gradient = useGradient
        ? this._barGradient(ctx, baseY - maxHeight, baseY)
        : null;
      var reflectionGradient =
        useGradient && cfg.mirrorY
          ? this._barGradient(ctx, baseY + maxHeight, baseY)
          : null;

      ctx.save();
      if (cfg.glow > 0) {
        ctx.shadowBlur = cfg.glow;
        ctx.shadowColor = this._glowColor(time);
      }

      for (var i = 0; i < count; i += 1) {
        var t = count > 1 ? i / (count - 1) : 0;
        var value = this._values[i];
        var visibleFloor = value > 0.002 ? (cfg.minHeight / 100) * maxHeight : 0;
        var barHeight = Math.max(visibleFloor, value * maxHeight);
        var fill = useGradient
          ? gradient
          : this._barColor(i, t, value, time);
        var radius = ((cfg.round / 100) * Math.min(width, barHeight)) / 2;
        var centers = useMirrorX
          ? [area.cx - (i + 0.5) * barWidth, area.cx + (i + 0.5) * barWidth]
          : [area.x + (i + 0.5) * barWidth];

        for (var c = 0; c < centers.length; c += 1) {
          if (barHeight < 0.05) continue;
          var cx = centers[c];
          var x = cx - width / 2;
          var y = baseY - barHeight;

          roundRectPath(ctx, x, y, width, barHeight, radius);
          ctx.fillStyle = fill;
          ctx.fill();

          if (cfg.mirrorY) {
            ctx.save();
            ctx.globalAlpha *= 0.42;
            roundRectPath(ctx, x, baseY, width, barHeight, radius);
            ctx.fillStyle = reflectionGradient || fill;
            ctx.fill();
            ctx.restore();
          }
        }
      }

      if (cfg.peakCaps) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = cfg.peakColor;
        var capHeight = Math.max(1.2, Math.min(3, width * 0.16));
        for (var p = 0; p < count; p += 1) {
          var peak = this._peaks[p];
          if (peak < 0.012) continue;
          var peakVisibleFloor = peak > 0.002 ? (cfg.minHeight / 100) * maxHeight : 0;
          var peakHeight = Math.max(peakVisibleFloor, peak * maxHeight);
          var centersPeak = useMirrorX
            ? [area.cx - (p + 0.5) * barWidth, area.cx + (p + 0.5) * barWidth]
            : [area.x + (p + 0.5) * barWidth];
          ctx.globalAlpha = (cfg.opacity / 100) * 0.86;
          for (var pc = 0; pc < centersPeak.length; pc += 1) {
            var peakX = centersPeak[pc] - width / 2;
            roundRectPath(
              ctx,
              peakX,
              baseY - peakHeight - capHeight / 2,
              width,
              capHeight,
              capHeight / 2
            );
            ctx.fill();
            if (cfg.mirrorY) {
              ctx.globalAlpha *= 0.55;
              roundRectPath(
                ctx,
                peakX,
                baseY + peakHeight - capHeight / 2,
                width,
                capHeight,
                capHeight / 2
              );
              ctx.fill();
              ctx.globalAlpha = (cfg.opacity / 100) * 0.86;
            }
          }
        }
      }

      ctx.restore();
    }

    _drawWave(ctx, area, time) {
      var cfg = this.settings;
      var values = this._waveValues;
      var count = values.length;
      if (count < 2) return;

      var maxAmplitude = 0;
      for (var a = 0; a < count; a += 1) {
        var absolute = Math.abs(values[a]);
        if (absolute > maxAmplitude) maxAmplitude = absolute;
      }
      if (maxAmplitude < 0.001) return;

      var amplitude = (area.h / 2) * (cfg.waveScale / 100);
      var stroke =
        cfg.colorMode === 'solid'
          ? cfg.color1
          : this._barGradient(ctx, area.y, area.y + area.h);

      var fill =
        cfg.colorMode === 'solid'
          ? rgba(cfg.color1, 0.16)
          : this._waveFillGradient(ctx, area);

      ctx.save();
      if (cfg.glow > 0) {
        ctx.shadowBlur = cfg.glow;
        ctx.shadowColor = this._glowColor(time);
      }

      var self = this;
      function trace(direction) {
        ctx.beginPath();
        for (var i = 0; i < count; i += 1) {
          var x = area.x + (i / (count - 1)) * area.w;
          var y = area.cy - values[i] * amplitude * direction;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }

      if (cfg.waveFill) {
        trace(1);
        ctx.lineTo(area.x + area.w, area.cy);
        ctx.lineTo(area.x, area.cy);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }

      ctx.lineWidth = cfg.lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke;
      trace(1);
      ctx.stroke();

      if (cfg.mirrorY) {
        ctx.save();
        ctx.globalAlpha *= 0.35;
        ctx.strokeStyle = stroke;
        ctx.shadowBlur = Math.max(0, cfg.glow * 0.5);
        trace(-1);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    _waveFillGradient(ctx, area) {
      var cfg = this.settings;
      var gradient = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
      gradient.addColorStop(0, rgba(cfg.color2, 0.2));
      gradient.addColorStop(0.5, rgba(cfg.color1, 0.12));
      gradient.addColorStop(1, rgba(cfg.color1, 0.015));
      return gradient;
    }

    _drawRadial(ctx, area, time) {
      var cfg = this.settings;
      var count = this._activeCount;
      if (!count) return;

      var cx = area.cx;
      var cy = area.cy;
      var outer = Math.min(area.w, area.h) / 2;
      var inner = (outer * cfg.innerRadius) / 100;
      if (outer - inner < 1) return;

      var barSpan = TAU / count;
      var midRadius = (inner + outer) / 2;
      var lineWidth = Math.max(1.2, (barSpan * midRadius * (1 - cfg.gap / 100)));
      var gradient = null;
      if (cfg.colorMode === 'gradient') {
        gradient = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        gradient.addColorStop(0, cfg.color1);
        gradient.addColorStop(0.55, cfg.color2);
        gradient.addColorStop(1, cfg.color3);
      }

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = lineWidth;
      if (cfg.glow > 0) {
        ctx.shadowBlur = cfg.glow;
        ctx.shadowColor = this._glowColor(time);
      }

      for (var i = 0; i < count; i += 1) {
        if (this._values[i] < 0.0004) continue;
        var t = count > 1 ? i / (count - 1) : 0;
        var value = this._values[i];
        var visibleFloor = value > 0.002 ? cfg.minHeight / 100 : 0;
        var extension = Math.max(visibleFloor, value) * (outer - inner);
        var angle = -Math.PI / 2 + this._angle + i * barSpan;
        var cos = Math.cos(angle);
        var sin = Math.sin(angle);
        var innerX = cx + cos * inner;
        var innerY = cy + sin * inner;
        var outerX = cx + cos * (inner + extension);
        var outerY = cy + sin * (inner + extension);

        ctx.beginPath();
        ctx.moveTo(innerX, innerY);
        ctx.lineTo(outerX, outerY);
        ctx.strokeStyle = gradient || this._barColor(i, t, value, time);
        ctx.stroke();
      }

      if (cfg.peakCaps) {
        ctx.shadowBlur = 0;
        ctx.fillStyle = cfg.peakColor;
        ctx.globalAlpha = (cfg.opacity / 100) * 0.82;
        var dotRadius = Math.max(1.1, Math.min(3.2, lineWidth * 0.32));
        for (var p = 0; p < count; p += 1) {
          var peak = this._peaks[p];
          if (peak < 0.012) continue;
          var anglePeak = -Math.PI / 2 + this._angle + p * barSpan;
          var peakRadius = inner + Math.max(cfg.minHeight / 100, peak) * (outer - inner);
          ctx.beginPath();
          ctx.arc(
            cx + Math.cos(anglePeak) * peakRadius,
            cy + Math.sin(anglePeak) * peakRadius,
            dotRadius,
            0,
            TAU
          );
          ctx.fill();
        }
      }

      ctx.restore();
    }
  }

  global.FrequencyVisualizer = FrequencyVisualizer;
})(window);
