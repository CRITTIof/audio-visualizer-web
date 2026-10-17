/*
 * A dedicated worker clock for the capture console.
 *
 * Chrome throttles window.setInterval() in hidden/background tabs down to about
 * one tick per second. Web Worker timers are not subject to that page timer
 * throttling in current Chromium, so the capture loop stays at full speed even
 * when the console window is minimized or behind the game.
 */
'use strict';

let timer = null;

function stop() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = function (event) {
  const data = event.data || {};
  if (data.type === 'start') {
    stop();
    const interval = Math.min(250, Math.max(8, Number(data.interval) || 33));
    timer = setInterval(function () {
      self.postMessage({ type: 'tick' });
    }, interval);
    return;
  }
  if (data.type === 'stop') {
    stop();
  }
};
