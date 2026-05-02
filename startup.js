/* ═══════════════════════════════════════════════════════════
   AVIAN — startup.js
   Full startup controller. Runs BEFORE main app logic.
   Sequence: Splash → SW Register → Net Check → Version
             Check → Download Update → Launch Signal
═══════════════════════════════════════════════════════════ */

;(function AvianStartup() {
  'use strict';

  /* ── Constants ─────────────────────────────── */
  const BASE         = '/Avian';
  const VERSION_URL  = 'https://raw.githubusercontent.com/joshuatalaid/Avian/main/version.json';
  const VERSION_KEY  = 'avian_version';
  const CACHE_NAME   = 'avian-cache-v2.0.0';
  const SPLASH_MIN   = 2400;
  const NET_TIMEOUT  = 5000;
  const VER_TIMEOUT  = 6000;

  /* Files to refresh on update */
  const UPDATE_ASSETS = [
    `${BASE}/`,
    `${BASE}/index.html`,
    `${BASE}/style.css`,
    `${BASE}/script.js`,
    `${BASE}/startup.js`,
    `${BASE}/manifest.json`,
    `${BASE}/version.json`,
    `${BASE}/model/model.json`,
    `${BASE}/model/metadata.json`,
    `${BASE}/model/weights.bin`,
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js',
  ];

  /* Splash steps (id, progress 0-1, label) */
  const STEPS = [
    { id:'init',   pct:0.05, label:'Initialising application\u2026'       },
    { id:'sw',     pct:0.12, label:'Setting up offline support\u2026'      },
    { id:'net',    pct:0.28, label:'Checking internet connection\u2026'    },
    { id:'ver',    pct:0.45, label:'Checking for updates\u2026'            },
    { id:'dl',     pct:0.60, label:'Downloading latest version\u2026'      },
    { id:'model',  pct:0.82, label:'Loading AI model\u2026'                },
    { id:'launch', pct:1.00, label:'Launching Avian\u2026'                 },
  ];

  /* DOM refs */
  let $splash, $status, $sub, $barFill, $barPct, $offlinePill, $dots;

  /* ════════════════════════════════════════
     ENTRY
  ════════════════════════════════════════ */
  function init() {
    $splash      = document.getElementById('avian-splash');
    $status      = document.getElementById('splash-status');
    $sub         = document.getElementById('splash-substatus');
    $barFill     = document.getElementById('splash-bar-fill');
    $barPct      = document.getElementById('splash-bar-pct');
    $offlinePill = document.getElementById('splash-offline');
    $dots        = document.getElementById('splash-step-dots');
    buildDots();

    /* Hard failsafe — if startup ever gets stuck (JS error, bad network
       state, animationend never fires) this will force-exit the splash
       after 15 seconds so the user is never left on a frozen screen. */
    setTimeout(() => {
      if ($splash && $splash.style.display !== 'none') {
        console.warn('[Startup] Failsafe triggered — forcing splash exit');
        forceExitSplash();
      }
    }, 15000);

    run();
  }

  function buildDots() {
    if (!$dots) return;
    $dots.innerHTML = STEPS.map(s =>
      `<span class="sdot pending" id="sdot-${s.id}"></span>`
    ).join('');
  }

  /* ════════════════════════════════════════
     MAIN SEQUENCE
  ════════════════════════════════════════ */
  async function run() {
    const t0 = Date.now();

    try {
      await toStep('init');
      await wait(280);

      await toStep('sw');
      registerSW();
      await wait(220);

      await toStep('net');
      const online = await probeNetwork();

      if (!online) {
        showOffline();
        setSub('Loading cached version \u2014 works without internet \u2713');
        await wait(1100);
        return launch(t0);
      }

      setSub('Connected \u2713');
      await wait(180);

      await toStep('ver');
      const upd = await fetchVersionInfo();

      if (!upd.hasUpdate) {
        setSub(upd.reason || 'Already up to date \u2713');
        await wait(300);
      } else {
        await toStep('dl');
        await downloadUpdate(upd);
      }

      await toStep('model');
      setSub('Initialising TensorFlow.js\u2026');
      await wait(380);

    } catch (err) {
      console.warn('[Startup] Error:', err);
      setSub('Starting with cached version\u2026');
      await wait(600);
    }

    launch(t0);
  }

  /* ════════════════════════════════════════
     NETWORK PROBE
  ════════════════════════════════════════ */
  async function probeNetwork() {
    if (!navigator.onLine) return false;
    const probes = [
      () => tFetch(
        'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js',
        { method:'HEAD', mode:'no-cors', cache:'no-store' },
        NET_TIMEOUT
      ),
      () => tFetch(VERSION_URL, { method:'HEAD', cache:'no-store' }, NET_TIMEOUT),
    ];
    for (const p of probes) {
      try { await p(); return true; } catch {}
    }
    return false;
  }

  /* ════════════════════════════════════════
     VERSION CHECK
  ════════════════════════════════════════ */
  async function fetchVersionInfo() {
    try {
      const res = await tFetch(VERSION_URL, { cache:'no-store' }, VER_TIMEOUT);
      if (!res.ok) return { hasUpdate:false, reason:'Version check unavailable' };

      const data   = await res.json();
      const remote = String(data.version || '').trim();
      const local  = (localStorage.getItem(VERSION_KEY) || '').trim();

      if (!local) {
        localStorage.setItem(VERSION_KEY, remote);
        return { hasUpdate:false, reason:`Version ${remote} stored` };
      }

      const newer = semverGt(remote, local);
      console.log(`[Startup] Version check: local=${local} remote=${remote} update=${newer}`);
      return { hasUpdate:newer, remote, local };

    } catch (err) {
      console.warn('[Startup] Version check failed:', err.message);
      return { hasUpdate:false, reason:'Update check skipped (offline?)' };
    }
  }

  function semverGt(a, b) {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d > 0;
    }
    return false;
  }

  /* ════════════════════════════════════════
     DOWNLOAD UPDATE
  ════════════════════════════════════════ */
  async function downloadUpdate({ remote }) {
    setSub(`v${remote} available \u2014 caching ${UPDATE_ASSETS.length} files\u2026`);

    let cache;
    try { cache = await caches.open(CACHE_NAME); }
    catch { setSub('Cache unavailable \u2014 skipping update'); await wait(600); return; }

    let done = 0;
    const total = UPDATE_ASSETS.length;
    const dlPct = STEPS.find(s => s.id === 'dl').pct;

    await Promise.allSettled(UPDATE_ASSETS.map(async url => {
      try {
        const res = await tFetch(url, { cache:'no-cache' }, 20000);
        if (res.ok || res.type === 'opaque') await cache.put(url, res);
      } catch (e) {
        console.warn('[Startup] Cache miss:', url, e.message);
      } finally {
        done++;
        const ratio = (STEPS.findIndex(s => s.id === 'dl') / (STEPS.length - 1))
          + (dlPct * done / total) * 0.18;
        setBar(Math.min(ratio, dlPct), `${done} / ${total} files cached`);
      }
    }));

    localStorage.setItem(VERSION_KEY, remote);
    setSub(`Updated to v${remote} \u2713`);
    setBar(dlPct, '');
    await wait(520);
  }

  /* ════════════════════════════════════════
     SERVICE WORKER
  ════════════════════════════════════════ */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register(`${BASE}/service-worker.js`, { scope:`${BASE}/` })
      .then(reg => {
        console.log('[SW] Registered:', reg.scope);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              window.__swWaiting = sw;
            }
          });
        });
      })
      .catch(e => console.warn('[SW] Registration failed:', e));
  }

  /* ════════════════════════════════════════
     LAUNCH & TRANSITION
  ════════════════════════════════════════ */
  async function launch(t0) {
    await toStep('launch');
    setBar(1.0, '');
    setSub('');
    const elapsed = Date.now() - t0;
    await wait(Math.max(0, SPLASH_MIN - elapsed) + 200);
    exitSplash();
  }

  /* Lift the inline visibility:hidden guard and reveal the app shell,
     then animate the splash out. Falls back to forceExitSplash if the
     CSS exit animation never fires (e.g. reduced-motion or style.css
     failed to load so .splash-out has no keyframes). */
  function exitSplash() {
    if (!$splash) { forceExitSplash(); return; }

    /* Reveal app shell before the splash starts fading */
    revealAppShell();

    $splash.classList.add('splash-out');

    /* Fallback: if animationend hasn't fired within 800ms, force-remove */
    const fallback = setTimeout(() => {
      console.warn('[Startup] animationend did not fire — forcing exit');
      forceExitSplash();
    }, 800);

    $splash.addEventListener('animationend', () => {
      clearTimeout(fallback);
      forceExitSplash();
    }, { once: true });
  }

  /* Hard removal — no animation dependency */
  function forceExitSplash() {
    revealAppShell();
    if ($splash) $splash.style.display = 'none';
    /* Set a persistent flag BEFORE dispatching the event.
       script.js (deferred) may not have registered its listener yet —
       the flag lets it catch up via polling without relying on event timing. */
    window.__avianReady = true;
    window.dispatchEvent(new CustomEvent('avian:ready'));
  }

  /* Override the visibility:hidden !important guard set by index.html <style>.
     removeProperty() cannot beat !important — must use setProperty with
     !important priority to win the specificity battle. */
  function revealAppShell() {
    const shell = document.getElementById('app-shell');
    if (shell) shell.style.setProperty('visibility', 'visible', 'important');
    document.querySelectorAll('.bg-orb').forEach(el =>
      el.style.setProperty('visibility', 'visible', 'important')
    );
  }

  /* ════════════════════════════════════════
     UI HELPERS
  ════════════════════════════════════════ */
  async function toStep(id) {
    const step = STEPS.find(s => s.id === id);
    if (!step) return;
    if ($status) {
      $status.classList.add('status-fade');
      await wait(110);
      $status.textContent = step.label;
      $status.classList.remove('status-fade');
    }
    setBar(step.pct);
    highlightDot(id);
  }

  function setSub(txt) { if ($sub) $sub.textContent = txt; }

  function setBar(ratio, subTxt) {
    const pct = Math.min(100, Math.round(ratio * 100));
    if ($barFill) $barFill.style.width = pct + '%';
    if ($barPct) $barPct.textContent = pct + '%';
    if (subTxt !== undefined) setSub(subTxt);
  }

  function highlightDot(id) {
    if (!$dots) return;
    const idx = STEPS.findIndex(s => s.id === id);
    STEPS.forEach((s, i) => {
      const d = document.getElementById(`sdot-${s.id}`);
      if (!d) return;
      d.className = 'sdot ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
    });
  }

  function showOffline() {
    if ($offlinePill) $offlinePill.classList.add('visible');
  }

  function tFetch(url, opts, ms) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* Kick off */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
