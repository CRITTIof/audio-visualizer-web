/*
 * Loads the editable hero/interface theme from /ui-theme.json.
 * Reload the page after changing the JSON file.
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var titleElement = document.getElementById('pageTitle');
  var subtitleElement = document.getElementById('pageSubtitle');

  function setVar(name, value) {
    if (value === undefined || value === null || value === '') return;
    root.style.setProperty(name, String(value));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function finiteNumber(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function cssLength(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value + 'px';
    if (typeof value === 'string' && value.trim()) return value.trim();
    return null;
  }

  function applyOpacity(name, value) {
    var parsed = finiteNumber(value);
    if (parsed === null) return;
    setVar(name, clamp(parsed, 0, 1));
  }

  function applyTitle(title) {
    if (!title || typeof title !== 'object') return;

    if (typeof title.text === 'string') {
      if (titleElement) titleElement.textContent = title.text;
      if (title.text.trim()) document.title = title.text;
    }
    setVar('--title-font-family', title.fontFamily);
    setVar('--title-font-size', cssLength(title.fontSize));
    setVar('--title-font-weight', title.fontWeight);
    setVar('--title-color', title.color);
    setVar('--title-letter-spacing', title.letterSpacing);
    setVar('--title-line-height', title.lineHeight);
    applyOpacity('--title-opacity', title.opacity);

    var fadeStart = finiteNumber(title.fadeStart);
    var fadeEnd = finiteNumber(title.fadeEnd);
    if (fadeStart !== null) {
      fadeStart = clamp(fadeStart, 0, 99);
      setVar('--title-fade-start', fadeStart + '%');
    }
    if (fadeEnd !== null) {
      fadeEnd = clamp(fadeEnd, 1, 100);
      if (fadeStart !== null && fadeEnd <= fadeStart) {
        fadeEnd = Math.min(100, fadeStart + 1);
      }
      setVar('--title-fade-end', fadeEnd + '%');
    }
  }

  function applySubtitle(subtitle) {
    if (!subtitle || typeof subtitle !== 'object') return;

    if (subtitleElement && typeof subtitle.text === 'string') {
      subtitleElement.textContent = subtitle.text;
    }
    setVar('--subtitle-font-family', subtitle.fontFamily);
    setVar('--subtitle-font-size', cssLength(subtitle.fontSize));
    setVar('--subtitle-font-weight', subtitle.fontWeight);
    setVar('--subtitle-color', subtitle.color);
    setVar('--subtitle-letter-spacing', subtitle.letterSpacing);
    applyOpacity('--subtitle-opacity', subtitle.opacity);
  }

  function applyInterface(settings) {
    if (!settings || typeof settings !== 'object') return;

    setVar('--font', settings.fontFamily);
    setVar('--ink', settings.textColor);
    setVar('--ink-strong', settings.textColor);
    setVar('--muted', settings.mutedColor);
  }

  function applyBackground(background) {
    if (!background || typeof background !== 'object') return;

    setVar('--bg', background.color);
    setVar('--grid-color', background.gridColor);

    var size = finiteNumber(background.gridSize);
    if (size !== null && size >= 6) {
      setVar('--grid-size', size + 'px');
    }

    var minOpacity = finiteNumber(background.gridMinOpacity);
    var maxOpacity = finiteNumber(background.gridMaxOpacity);
    if (minOpacity !== null) {
      minOpacity = clamp(minOpacity, 0, 1);
      setVar('--grid-opacity-min', minOpacity);
    }
    if (maxOpacity !== null) {
      maxOpacity = clamp(maxOpacity, 0, 1);
      setVar('--grid-opacity-max', maxOpacity);
    }
    if (minOpacity !== null && maxOpacity !== null) {
      setVar('--grid-opacity-corner', Math.max(0, maxOpacity - minOpacity));
    }
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    applyTitle(theme.title);
    applySubtitle(theme.subtitle);
    applyInterface(theme.interface);
    applyBackground(theme.background);
    root.dataset.uiTheme = 'ready';
  }

  fetch('/ui-theme.json', { cache: 'no-store' })
    .then(function (response) {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    })
    .then(applyTheme)
    .catch(function (error) {
      console.warn('[主题] 无法读取 ui-theme.json，继续使用内置样式。', error);
    });
})();
