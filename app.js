(() => {
  'use strict';

  // ---------- Settings ----------
  const DEFAULTS = {
    work: 30, rest: 10, rounds: 8, prep: 5,
    sound: true, volume: 80, pitch: 0, countdown: 3,
    countdownSound: 'beep', workSound: 'whistle', restSound: 'chime', finishSound: 'bell',
  };
  const STORAGE_KEY = 'tabata.settings.v1';

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Object.assign({}, DEFAULTS, saved || {});
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
  }

  let settings = loadSettings();

  // ---------- Audio (Web Audio API, no files) ----------
  const SOUNDS = {
    beep:    { label: 'Classic beep', dur: 0.18 },
    double:  { label: 'Double beep',  dur: 0.3 },
    chime:   { label: 'Soft chime',   dur: 0.9 },
    bell:    { label: 'Bell',         dur: 1.2 },
    whistle: { label: 'Whistle',      dur: 0.5 },
    buzzer:  { label: 'Buzzer',       dur: 0.55 },
  };

  let ctx = null;
  let master = null;
  let noiseBuffer = null;

  // Must be called from a user gesture (tap) so iOS allows sound.
  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) {
      // iOS 17+: play through the ringer/silent switch like a media app.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.connect(comp).connect(ctx.destination);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    // Play a silent buffer to fully unlock audio on older iOS.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }

  function tone(out, type, freq, t, dur, peak, attack = 0.005) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur - 0.03));
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  function pluck(out, freq, t, decay, peak) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  const SYNTH = {
    beep(out, t, m) {
      tone(out, 'square', 880 * m, t, 0.16, 0.2);
    },
    double(out, t, m) {
      tone(out, 'triangle', 1200 * m, t, 0.09, 0.45);
      tone(out, 'triangle', 1200 * m, t + 0.14, 0.09, 0.45);
    },
    chime(out, t, m) {
      pluck(out, 1046.5 * m, t, 0.9, 0.4);
      pluck(out, 2093 * m, t, 0.5, 0.12);
      pluck(out, 3136 * m, t, 0.3, 0.05);
    },
    bell(out, t, m) {
      [[1, 0.4, 1.4], [2.01, 0.2, 1.0], [2.76, 0.12, 0.7], [5.4, 0.06, 0.4]]
        .forEach(([ratio, amp, decay]) => pluck(out, 523.25 * m * ratio, t, decay, amp));
    },
    whistle(out, t, m) {
      const dur = 0.45;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.02);
      g.gain.setValueAtTime(1, t + dur - 0.06);
      g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(out);

      // Fluttering "pea" whistle: sine with fast frequency wobble...
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(2300 * m, t);
      o.frequency.linearRampToValueAtTime(2450 * m, t + 0.08);
      lfo.frequency.value = 28;
      lfoGain.gain.value = 140 * m;
      lfo.connect(lfoGain).connect(o.frequency);
      og.gain.value = 0.3;
      o.connect(og).connect(g);

      // ...plus a little breathy noise.
      const n = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const ng = ctx.createGain();
      n.buffer = noiseBuffer;
      bp.type = 'bandpass';
      bp.frequency.value = 2400 * m;
      bp.Q.value = 6;
      ng.gain.value = 0.25;
      n.connect(bp).connect(ng).connect(g);

      [o, lfo, n].forEach((node) => { node.start(t); node.stop(t + dur + 0.05); });
    },
    buzzer(out, t, m) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1500;
      f.connect(out);
      tone(f, 'sawtooth', 160 * m, t, 0.5, 0.25);
      tone(f, 'square', 161.5 * m, t, 0.5, 0.12);
    },
  };

  function play(name, offset = 0, mul = 1, force = false) {
    if (!ctx || !SYNTH[name] || (!settings.sound && !force)) return;
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    master.gain.setValueAtTime(Math.pow(settings.volume / 100, 2) * 1.6, now);
    const m = Math.pow(2, settings.pitch / 12) * mul;
    SYNTH[name](master, now + 0.01 + offset, m);
  }

  // "Workout finished" plays the chosen sound as a rising three-note flourish.
  function playFinish(name, force = false) {
    const step = Math.min(0.45, Math.max(0.22, SOUNDS[name].dur * 0.6));
    [1, 1.26, 1.5].forEach((r, i) => play(name, i * step, r, force));
  }

  function testSound() {
    initAudio();
    const beeps = Math.max(settings.countdown, 3);
    for (let i = 0; i < beeps; i++) play(settings.countdownSound, i * 0.6, 1, true);
    play(settings.workSound, beeps * 0.6, 1, true);
  }

  // ---------- Screen wake lock ----------
  let wakeLock = null;
  async function keepAwake() {
    if (!('wakeLock' in navigator) || wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { /* not allowed right now; retried on next visibility change */ }
  }
  function allowSleep() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // ---------- Timer ----------
  let state = 'idle'; // idle | running | paused | done
  let plan = null;    // { phases: [{type, dur, round}], rounds }
  let idx = 0;
  let phaseEnd = 0;   // performance.now() timestamp when the current phase ends
  let remainingMs = 0;
  let lastSec = 0;
  let timerId = null;

  function buildPlan() {
    const phases = [];
    if (settings.prep > 0) phases.push({ type: 'prep', dur: settings.prep, round: 1 });
    for (let r = 1; r <= settings.rounds; r++) {
      phases.push({ type: 'work', dur: settings.work, round: r });
      if (r < settings.rounds && settings.rest > 0) phases.push({ type: 'rest', dur: settings.rest, round: r });
    }
    return { phases, rounds: settings.rounds };
  }

  function currentRemaining() {
    return state === 'running' ? Math.max(0, phaseEnd - performance.now()) : remainingMs;
  }

  function phaseStartSound(phase) {
    if (phase.type === 'work') play(settings.workSound);
    else if (phase.type === 'rest') play(settings.restSound);
  }

  function start() {
    initAudio();
    if (state === 'running') return;
    if (state === 'idle' || state === 'done') {
      plan = buildPlan();
      idx = 0;
      remainingMs = plan.phases[0].dur * 1000;
      lastSec = plan.phases[0].dur;
      phaseStartSound(plan.phases[0]);
    }
    state = 'running';
    phaseEnd = performance.now() + remainingMs;
    clearInterval(timerId);
    timerId = setInterval(tick, 50);
    keepAwake();
    render();
  }

  function pause() {
    if (state !== 'running') return;
    remainingMs = Math.max(0, phaseEnd - performance.now());
    state = 'paused';
    clearInterval(timerId);
    allowSleep();
    render();
  }

  function reset() {
    clearInterval(timerId);
    state = 'idle';
    plan = null;
    allowSleep();
    render();
  }

  function finish() {
    clearInterval(timerId);
    state = 'done';
    playFinish(settings.finishSound);
    allowSleep();
    render();
  }

  function tick() {
    if (state !== 'running') return;
    let rem = phaseEnd - performance.now();

    // Advance (possibly several phases, if the page was throttled).
    while (rem <= 0) {
      idx++;
      if (idx >= plan.phases.length) { finish(); return; }
      const next = plan.phases[idx];
      phaseEnd += next.dur * 1000;
      rem = phaseEnd - performance.now();
      lastSec = next.dur;
      if (rem > 0) phaseStartSound(next);
    }

    const secs = Math.ceil(rem / 1000);
    if (secs < lastSec) {
      lastSec = secs;
      const phase = plan.phases[idx];
      if (secs >= 1 && secs <= settings.countdown && secs < phase.dur) play(settings.countdownSound);
    }
    render();
  }

  // ---------- Rendering ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    phase: $('phase'), count: $('count'), round: $('round'), bar: $('bar'), total: $('total'),
    start: $('startBtn'), pause: $('pauseBtn'), reset: $('resetBtn'),
    theme: document.querySelector('meta[name="theme-color"]'),
  };
  const LABELS = { prep: 'Get ready', work: 'Work', rest: 'Rest' };
  const COLORS = { idle: '#111827', prep: '#d97706', work: '#16a34a', rest: '#dc2626', done: '#2563eb' };

  function fmt(sec) {
    sec = Math.max(0, Math.ceil(sec));
    if (sec < 60) return String(sec);
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function totalOf(phases, from = 0) {
    let s = 0;
    for (let i = from; i < phases.length; i++) s += phases[i].dur;
    return s;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function render() {
    let phaseType, label, countText, roundText, frac, totalSec;

    if (state === 'idle') {
      const p = buildPlan();
      phaseType = 'idle';
      label = 'Ready';
      countText = fmt(settings.work);
      roundText = settings.rounds + (settings.rounds === 1 ? ' round' : ' rounds');
      frac = 0;
      totalSec = totalOf(p.phases);
    } else if (state === 'done') {
      phaseType = 'done';
      label = 'Done!';
      countText = '0';
      roundText = plan.rounds + ' / ' + plan.rounds + ' rounds';
      frac = 1;
      totalSec = 0;
    } else {
      const ph = plan.phases[idx];
      const rem = currentRemaining();
      phaseType = ph.type;
      label = state === 'paused' ? 'Paused' : LABELS[ph.type];
      countText = fmt(rem / 1000);
      roundText = 'Round ' + ph.round + ' / ' + plan.rounds;
      frac = 1 - rem / (ph.dur * 1000);
      totalSec = rem / 1000 + totalOf(plan.phases, idx + 1);
    }

    if (document.body.dataset.phase !== phaseType) {
      document.body.dataset.phase = phaseType;
      el.theme.setAttribute('content', COLORS[phaseType]);
    }
    document.body.classList.toggle('paused', state === 'paused');
    setText(el.phase, label);
    setText(el.count, countText);
    el.count.classList.toggle('long', countText.length > 2);
    setText(el.round, roundText);
    setText(el.total, (state === 'idle' ? 'Total ' : 'Left ') + fmtClock(totalSec));
    el.bar.style.width = (Math.min(1, Math.max(0, frac)) * 100).toFixed(2) + '%';

    setText(el.start, state === 'paused' ? 'Resume' : 'Start');
    el.start.disabled = state === 'running';
    el.pause.disabled = state !== 'running';
    el.reset.disabled = state === 'idle';
    $('activeHint').hidden = !(state === 'running' || state === 'paused');
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  // ---------- Settings panel ----------
  const sheet = $('sheet');

  function fillControls() {
    ['work', 'rest', 'rounds', 'prep'].forEach((k) => { $(k).value = settings[k]; });
    $('sound').checked = settings.sound;
    $('volume').value = settings.volume;
    $('pitch').value = settings.pitch;
    $('countdown').value = settings.countdown;
    ['countdownSound', 'workSound', 'restSound', 'finishSound'].forEach((k) => { $(k).value = settings[k]; });
    updateOutputs();
  }

  function updateOutputs() {
    $('volumeOut').value = settings.volume + '%';
    $('pitchOut').value = (settings.pitch > 0 ? '+' : '') + settings.pitch;
    $('countdownOut').value = String(settings.countdown);
  }

  function changed() {
    saveSettings();
    updateOutputs();
    render();
  }

  document.querySelectorAll('.stepper').forEach((box) => {
    const key = box.dataset.key;
    const min = Number(box.dataset.min);
    const max = Number(box.dataset.max);
    const step = Number(box.dataset.step);
    const input = box.querySelector('input');
    const set = (v) => {
      v = Math.round(Number(v));
      if (!Number.isFinite(v)) v = settings[key];
      v = Math.min(max, Math.max(min, v));
      settings[key] = v;
      input.value = v;
      changed();
    };
    box.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const cur = settings[key];
        set(Number(b.dataset.dir) > 0
          ? Math.floor(cur / step) * step + step
          : Math.ceil(cur / step) * step - step);
      });
    });
    input.addEventListener('change', () => set(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  });

  $('sound').addEventListener('change', (e) => {
    settings.sound = e.target.checked;
    changed();
    if (settings.sound) { initAudio(); play(settings.countdownSound); }
  });

  ['volume', 'pitch', 'countdown'].forEach((k) => {
    const input = $(k);
    input.addEventListener('input', () => { settings[k] = Number(input.value); updateOutputs(); });
    input.addEventListener('change', () => {
      settings[k] = Number(input.value);
      changed();
      if (k !== 'countdown') { initAudio(); play(settings.countdownSound, 0, 1, true); }
    });
  });

  function previewSound(key) {
    initAudio();
    if (key === 'finishSound') playFinish(settings[key], true);
    else play(settings[key], 0, 1, true);
  }

  ['countdownSound', 'workSound', 'restSound', 'finishSound'].forEach((k) => {
    const select = $(k);
    Object.entries(SOUNDS).forEach(([value, info]) => {
      select.add(new Option(info.label, value));
    });
    select.addEventListener('change', () => {
      settings[k] = select.value;
      changed();
      previewSound(k);
    });
  });

  document.querySelectorAll('[data-test]').forEach((b) => {
    b.addEventListener('click', () => previewSound(b.dataset.test));
  });

  $('testSound').addEventListener('click', testSound);

  $('resetDefaults').addEventListener('click', () => {
    if (!confirm('Restore all settings to their defaults?')) return;
    settings = Object.assign({}, DEFAULTS);
    fillControls();
    changed();
  });

  function openSettings() {
    fillControls();
    sheet.hidden = false;
    $('closeSettings').focus();
  }
  function closeSettings() {
    if (document.activeElement) document.activeElement.blur();
    sheet.hidden = true;
  }
  $('openSettings').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSettings(); });

  // ---------- Main controls & lifecycle ----------
  el.start.addEventListener('click', start);
  el.pause.addEventListener('click', pause);
  el.reset.addEventListener('click', reset);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) { closeSettings(); return; }
    if (!sheet.hidden || e.target.closest('input, select, button')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state === 'running') pause(); else start();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (state === 'running') { keepAwake(); tick(); }
  });

  // iOS can suspend audio after interruptions; any tap brings it back.
  document.addEventListener('pointerdown', () => {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  }, { passive: true });

  fillControls();
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
