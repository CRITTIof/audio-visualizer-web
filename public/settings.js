/*
 * Shared settings schema for the capture console and the transparent overlay.
 * Works both as a CommonJS module (server-side validation) and as a browser
 * global. Keep this file dependency-free.
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.VisualizerSettings = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SPECTRUM_MIN = 20;
  const SPECTRUM_MAX = 20000;
  const SOURCE_BANDS = 192;
  const WAVE_POINTS = 256;

  const DEFAULTS = Object.freeze({
    // Renderer -----------------------------------------------------------
    renderer: 'bars',
    alignX: 'center',
    alignY: 'bottom',
    areaWidth: 92,
    areaHeight: 58,
    opacity: 100,

    // Spectrum / motion --------------------------------------------------
    barCount: 72,
    gap: 26,
    minFreq: 30,
    maxFreq: 16000,
    scale: 'log',
    sensitivity: 1.35,
    tilt: 0.18,
    smoothing: 55,
    noiseFloor: 4,
    minHeight: 1,
    mirrorX: false,
    mirrorY: false,
    peakCaps: true,
    peakFall: 16,
    peakColor: '#ffffff',

    // Shape --------------------------------------------------------------
    round: 40,
    lineWidth: 3.5,
    waveFill: true,
    waveScale: 100,
    innerRadius: 28,
    spinSpeed: 8,

    // Color --------------------------------------------------------------
    colorMode: 'gradient',
    color1: '#22e6ff',
    color2: '#7b5cff',
    color3: '#ff3d9f',
    rainbowSaturation: 88,
    rainbowLightness: 58,
    hueDrift: 0,

    // Background ---------------------------------------------------------
    bgColor: '#000000',
    bgOpacity: 0,

    // Utility ------------------------------------------------------------
    showStatus: false
  });

  const RANGES = Object.freeze({
    areaWidth: [10, 100],
    areaHeight: [5, 100],
    opacity: [0, 100],
    barCount: [8, 192],
    gap: [0, 88],
    minFreq: [20, 2000],
    maxFreq: [200, 20000],
    sensitivity: [0.2, 5],
    tilt: [-0.8, 2],
    smoothing: [0, 95],
    noiseFloor: [0, 50],
    minHeight: [0, 40],
    peakFall: [2, 80],
    round: [0, 100],
    lineWidth: [0.5, 20],
    waveScale: [10, 300],
    innerRadius: [0, 72],
    spinSpeed: [-60, 60],
    rainbowSaturation: [0, 100],
    rainbowLightness: [20, 82],
    hueDrift: [-180, 180],
    bgOpacity: [0, 100]
  });

  const ENUMS = Object.freeze({
    renderer: ['bars', 'wave', 'radial'],
    alignX: ['left', 'center', 'right'],
    alignY: ['top', 'center', 'bottom'],
    scale: ['log', 'linear'],
    colorMode: ['gradient', 'solid', 'rainbow', 'level']
  });

  const COLOR_KEYS = new Set(['color1', 'color2', 'color3', 'peakColor', 'bgColor']);
  const BOOLEAN_KEYS = new Set([
    'mirrorX',
    'mirrorY',
    'peakCaps',
    'waveFill',
    'showStatus'
  ]);

  const PRESETS = Object.freeze([
    {
      id: 'neon',
      name: '霓虹脉冲',
      hint: '青紫粉渐变 / 圆角均衡器',
      settings: {
        renderer: 'bars',
        colorMode: 'gradient',
        color1: '#22e6ff',
        color2: '#7b5cff',
        color3: '#ff3d9f',
        smoothing: 58,
        barCount: 80,
        gap: 24,
        round: 46,
        peakCaps: true,
        mirrorX: false,
        mirrorY: false
      }
    },
    {
      id: 'aurora',
      name: '极光声纹',
      hint: '流动波形 / 柔和填充',
      settings: {
        renderer: 'wave',
        colorMode: 'gradient',
        color1: '#20ffc2',
        color2: '#29baff',
        color3: '#c06bff',
        smoothing: 34,
        lineWidth: 3.5,
        waveFill: true,
        waveScale: 92
      }
    },
    {
      id: 'orbit',
      name: '声轨环',
      hint: '环形频谱 / 缓慢旋转',
      settings: {
        renderer: 'radial',
        colorMode: 'gradient',
        color1: '#32f0ff',
        color2: '#7a5cff',
        color3: '#ff4fa3',
        barCount: 120,
        gap: 34,
        innerRadius: 34,
        spinSpeed: 9,
        peakCaps: true
      }
    },
    {
      id: 'mono',
      name: '极简白噪',
      hint: '纯白细柱 / 利落留白',
      settings: {
        renderer: 'bars',
        colorMode: 'solid',
        color1: '#ffffff',
        color2: '#ffffff',
        color3: '#ffffff',
        barCount: 64,
        gap: 38,
        round: 18,
        peakCaps: false,
        smoothing: 42,
        mirrorX: false
      }
    },
    {
      id: 'sunset',
      name: '落日镜像',
      hint: '橙红渐变 / 左右对称',
      settings: {
        renderer: 'bars',
        colorMode: 'gradient',
        color1: '#ffd23f',
        color2: '#ff7a2f',
        color3: '#ff2f7d',
        barCount: 76,
        gap: 22,
        round: 52,
        smoothing: 60,
        mirrorX: true,
        mirrorY: false,
        peakCaps: true
      }
    },
    {
      id: 'matrix',
      name: '荧光矩阵',
      hint: '电平着色 / 小圆角',
      settings: {
        renderer: 'bars',
        colorMode: 'level',
        color1: '#0aff9d',
        color2: '#1effcf',
        color3: '#d4ff4d',
        barCount: 96,
        gap: 48,
        round: 8,
        peakCaps: false,
        smoothing: 38,
        mirrorX: false
      }
    }
  ]);

  const INTEGER_KEYS = new Set(['barCount']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isColor(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function sanitize(input) {
    const source = input && typeof input === 'object' ? input : {};
    const out = {};

    for (const key of Object.keys(DEFAULTS)) {
      const fallback = DEFAULTS[key];
      const value = source[key];

      if (BOOLEAN_KEYS.has(key)) {
        out[key] = typeof value === 'boolean' ? value : fallback;
        continue;
      }

      if (COLOR_KEYS.has(key)) {
        out[key] = isColor(value) ? value.toLowerCase() : fallback;
        continue;
      }

      if (ENUMS[key]) {
        out[key] = ENUMS[key].includes(value) ? value : fallback;
        continue;
      }

      if (typeof fallback === 'number') {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) {
          out[key] = fallback;
          continue;
        }
        const [min, max] = RANGES[key] || [-Infinity, Infinity];
        let next = clamp(parsed, min, max);
        if (INTEGER_KEYS.has(key)) next = Math.round(next);
        out[key] = next;
        continue;
      }

      out[key] = fallback;
    }

    // Keep the frequency window usable and ordered.
    if (out.maxFreq < out.minFreq * 1.1) {
      out.maxFreq = Math.min(SPECTRUM_MAX, Math.max(out.minFreq * 1.5, 1000));
    }

    return out;
  }

  function sanitizeFrame(input) {
    if (!input || typeof input !== 'object') return null;
    const bands = Array.isArray(input.bands)
      ? input.bands.slice(0, 512).map(function (value) {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0;
        })
      : null;
    if (!bands || !bands.length) return null;

    const wave = Array.isArray(input.wave)
      ? input.wave.slice(0, 1024).map(function (value) {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? clamp(parsed, -1.5, 1.5) : 0;
        })
      : [];

    const rms = Number(input.rms);
    return {
      bands: bands,
      wave: wave,
      rms: Number.isFinite(rms) ? clamp(rms, 0, 1) : 0
    };
  }

  return {
    DEFAULTS: DEFAULTS,
    PRESETS: PRESETS,
    RANGES: RANGES,
    ENUMS: ENUMS,
    SPECTRUM_MIN: SPECTRUM_MIN,
    SPECTRUM_MAX: SPECTRUM_MAX,
    SOURCE_BANDS: SOURCE_BANDS,
    WAVE_POINTS: WAVE_POINTS,
    sanitize: sanitize,
    sanitizeFrame: sanitizeFrame,
    clamp: clamp
  };
});
