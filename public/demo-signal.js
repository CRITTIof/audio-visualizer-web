/*
 * A lightweight synthetic "music" generator used by the capture console's
 * demo button and the overlay's ?demo=1 preview mode. It produces the exact
 * same frame shape as the real analyser, so the whole pipeline can be tested
 * without granting screen-capture permission.
 */
(function (global) {
  'use strict';

  var BANDS = 192;
  var WAVE_POINTS = 256;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }

  function createFrame(time) {
    var t = time;
    var beat = Math.pow(Math.max(0, Math.sin(t * 2.35)), 7);
    var offbeat = Math.pow(Math.max(0, Math.sin(t * 2.35 + Math.PI)), 12);
    var snare = Math.pow(Math.max(0, Math.sin(t * 4.7 + 1.15)), 14);
    var bands = new Array(BANDS);
    var noiseSeed = Math.random();

    for (var i = 0; i < BANDS; i += 1) {
      var p = i / (BANDS - 1);
      var low = Math.exp(-p * 4.4);
      var body = Math.exp(-Math.pow((p - 0.34 - 0.06 * Math.sin(t * 0.53)) / 0.18, 2));
      var presence = Math.exp(-Math.pow((p - 0.68 - 0.08 * Math.sin(t * 0.37 + 1.2)) / 0.12, 2));
      var air = Math.exp(-Math.pow((p - 0.9) / 0.07, 2));
      var sway = 0.55 + 0.45 * Math.sin(t * 1.8 - p * 9.5);
      var grain =
        0.72 + 0.28 * Math.sin(p * 53 + t * 1.7) * Math.sin(p * 19 - t * 0.85);
      var traveling =
        0.2 *
        Math.exp(-Math.pow((p - ((t * 0.075) % 1)) / 0.022, 2)) *
        (0.35 + 0.65 * snare);
      var sparkle =
        0.16 *
        Math.exp(
          -Math.pow(
            (p - ((0.24 + noiseSeed * 0.48 + t * 0.028) % 1)) / 0.018,
            2
          )
        ) *
        (0.35 + 0.65 * Math.sin(t * 3.1 + 0.8));
      var hiss = Math.random() * (0.03 + 0.045 * air);

      var value =
        (0.018 +
          low * (0.2 + 0.62 * beat) * (0.8 + 0.2 * Math.sin(t * 1.2)) +
          body * (0.14 + 0.22 * sway) +
          presence * (0.045 + 0.17 * snare) +
          air * (0.03 + 0.12 * (0.5 + 0.5 * Math.sin(t * 2.9))) +
          traveling +
          sparkle +
          hiss +
          offbeat * 0.045) *
        1.52 *
        grain;

      bands[i] = round3(clamp(value, 0, 1));
    }

    var wave = new Array(WAVE_POINTS);
    for (var j = 0; j < WAVE_POINTS; j += 1) {
      var x = j / (WAVE_POINTS - 1);
      var envelope = 0.54 + 0.46 * Math.sin(Math.PI * x);
      var valueWave =
        Math.sin(x * Math.PI * 8 + t * 7.7) * 0.34 +
        Math.sin(x * Math.PI * 17 - t * 4.1) * 0.14 +
        Math.sin(x * Math.PI * 3 + t * 2.2) * (0.18 + beat * 0.22) +
        (Math.random() - 0.5) * 0.025;
      wave[j] = round3(clamp(valueWave * envelope, -1, 1));
    }

    var rms = clamp(0.12 + beat * 0.34 + snare * 0.12 + Math.random() * 0.02, 0, 1);
    return { bands: bands, wave: wave, rms: rms };
  }

  global.DemoSignal = { createFrame: createFrame };
})(window);
