/* ═══════════════════════════════════════════════
   AVIAN — script.js
   Main application logic.
   Triggered by the 'avian:ready' event from startup.js
   (NOT window.load — splash must finish first).
═══════════════════════════════════════════════ */

// ── State ──────────────────────────────────────
let model        = null;
let labels       = [];
let isModelReady = false;
let cameraStream = null;
let cameraOpen   = false;

// ── DOM refs ───────────────────────────────────
const statusChip    = document.getElementById('statusChip');
const statusEl      = document.getElementById('status');
const loadingVeil   = document.getElementById('loadingVeil');
const idleState     = document.getElementById('idleState');
const previewZone   = document.getElementById('previewZone');
const scanLine      = document.getElementById('scanLine');

const imageUpload   = document.getElementById('imageUpload');
const uploadTrigger = document.getElementById('uploadTrigger');
const cameraBtnEl   = document.getElementById('cameraBtn');
const captureRow    = document.getElementById('captureRow');
const captureBtn    = document.getElementById('captureBtn');

const video         = document.getElementById('video');
const canvas        = document.getElementById('canvas');
const imgEl         = document.getElementById('imagePreview');

const resultPanel   = document.getElementById('resultPanel');
const resultText    = document.getElementById('resultText');
const confFill      = document.getElementById('confFill');
const confLabel     = document.getElementById('confLabel');

const birdCard      = document.getElementById('birdDisplay');
const birdCardIcon  = document.getElementById('birdCardIcon');
const birdCardTitle = document.getElementById('birdCardTitle');
const birdCardDesc  = document.getElementById('birdDisplay_desc');
const birdTagsEl    = document.getElementById('birdTags');

const resetRow      = document.getElementById('resetRow');
const resetBtn      = document.getElementById('resetBtn');

// ── Bird knowledge base ────────────────────────
const birdData = {
  "Chicken Chicks": {
    emoji: '🐥',
    desc:  "Young chickens covered in soft down feathers. They stay close to their mother for warmth and protection.",
    tags:  ['Galliformes', 'Domestic', 'Juvenile']
  },
  "Hen": {
    emoji: '🐔',
    desc:  "An adult female chicken known for laying eggs and calmly foraging on the ground.",
    tags:  ['Galliformes', 'Domestic', 'Layer']
  },
  "Rooster": {
    emoji: '🐓',
    desc:  "The adult male chicken, known for bright feathers and loud crowing at dawn.",
    tags:  ['Galliformes', 'Domestic', 'Vocal']
  },
  "Magpie": {
    emoji: '🦅',
    desc:  "A black-and-white bird known for intelligence and attraction to shiny objects.",
    tags:  ['Corvidae', 'Passerine', 'Intelligent']
  },
  "Maya": {
    emoji: '🐦',
    desc:  "A brown bird (Common Myna) with a yellow beak, often found in urban areas with loud calls.",
    tags:  ['Sturnidae', 'Urban', 'Vocal']
  },
  "Pigeon": {
    emoji: '🕊️',
    desc:  "A common city bird with strong navigation skills and soft cooing sounds.",
    tags:  ['Columbidae', 'Urban', 'Navigator']
  },
  "Crow": {
    emoji: '🐦',
    desc:  "A highly intelligent black bird known for problem-solving and loud cawing.",
    tags:  ['Corvidae', 'Intelligent', 'Adaptable']
  },
  "Sparrow": {
    emoji: '🐦',
    desc:  "A small, social bird often found near humans, usually in flocks.",
    tags:  ['Passeridae', 'Passerine', 'Social']
  }
};

const defaultBirdData = {
  emoji: '🦅',
  desc:  'A fascinating bird species identified by the AI model. Birds are warm-blooded vertebrates defined by their feathers, beaks, and adaptations for flight.',
  tags:  ['Aves', 'Vertebrate', 'Warm-blooded']
};

// ── Load TF model ──────────────────────────────
async function loadModel() {
  try {
    setStatus('loading', 'Loading model…');
    model = await tf.loadLayersModel('model/model.json');

    const metaRes  = await fetch('model/metadata.json');
    const metaData = await metaRes.json();
    labels = metaData.labels;

    isModelReady = true;
    loadingVeil.classList.add('hidden');
    setStatus('ready', 'Model Ready');
    enableControls();

  } catch (err) {
    console.error('Model load error:', err);
    setStatus('error', 'Load Failed');
    if (loadingVeil) {
      loadingVeil.querySelector('p').textContent = 'Failed to load model — refresh to retry.';
    }
  }
}

function setStatus(state, text) {
  statusChip.className = 'status-chip ' + state;
  statusEl.textContent = text;
}

function enableControls() {
  uploadTrigger.disabled = false;
  cameraBtnEl.disabled   = false;
  imageUpload.disabled   = false;
}

// ── Ripple ─────────────────────────────────────
function spawnRipple(e, btn) {
  const rect = btn.getBoundingClientRect();
  const x = (e.clientX ?? rect.left + rect.width  / 2) - rect.left;
  const y = (e.clientY ?? rect.top  + rect.height / 2) - rect.top;
  const r = Math.max(rect.width, rect.height);
  const rip = document.createElement('span');
  rip.className = 'ripple';
  rip.style.cssText = `width:${r}px;height:${r}px;left:${x-r/2}px;top:${y-r/2}px`;
  btn.appendChild(rip);
  rip.addEventListener('animationend', () => rip.remove(), { once: true });
}

[uploadTrigger, cameraBtnEl, captureBtn, resetBtn].forEach(btn =>
  btn.addEventListener('click', e => spawnRipple(e, btn))
);

// ── Upload ─────────────────────────────────────
uploadTrigger.addEventListener('click', () => imageUpload.click());

imageUpload.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  closeCamera();
  hideResults();
  const url = URL.createObjectURL(file);
  showImage(url);
  imgEl.onload = () => predict(imgEl);
});

function showImage(src) {
  idleState.style.display = 'none';
  video.style.display     = 'none';
  imgEl.src               = src;
  imgEl.style.display     = 'block';
  previewZone.classList.add('has-content');
}

// ── Camera ─────────────────────────────────────
cameraBtnEl.addEventListener('click', async () => {
  if (cameraOpen) { closeCamera(); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 } },
      audio: false
    });
    video.srcObject     = cameraStream;
    video.style.display = 'block';
    imgEl.style.display = 'none';
    idleState.style.display = 'none';
    captureRow.classList.add('visible');
    cameraBtnEl.classList.add('active');
    cameraBtnEl.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
      Close`;
    cameraOpen = true;
    previewZone.classList.add('has-content');
    hideResults();
  } catch (err) {
    console.error('Camera error:', err);
    alert('Camera access denied or unavailable on this device.');
  }
});

captureBtn.addEventListener('click', () => {
  if (!cameraStream) return;
  canvas.width  = video.videoWidth  || 224;
  canvas.height = video.videoHeight || 224;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
  closeCamera();
  showImage(dataUrl);
  imgEl.onload = () => predict(imgEl);
});

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  video.style.display = 'none';
  captureRow.classList.remove('visible');
  cameraBtnEl.classList.remove('active');
  cameraBtnEl.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
    Camera`;
  cameraOpen = false;
}

// ── Prediction ─────────────────────────────────
async function predict(source) {
  if (!isModelReady) return;

  scanLine.classList.add('active');
  setStatus('loading', 'Identifying…');

  const tensor = tf.tidy(() =>
    tf.browser.fromPixels(source)
      .resizeNearestNeighbor([224, 224])
      .toFloat()
      .div(255.0)
      .expandDims(0)
  );

  let predValues;
  try {
    predValues = await model.predict(tensor).data();
  } finally {
    tensor.dispose();
    scanLine.classList.remove('active');
    setStatus('ready', 'Model Ready');
  }

  let maxVal = 0, maxIdx = 0;
  predValues.forEach((v, i) => { if (v > maxVal) { maxVal = v; maxIdx = i; } });

  showResult(labels[maxIdx] ?? 'Unknown Bird', maxVal * 100);
}

// ── Show result ────────────────────────────────
function showResult(label, confidence) {
  resultText.textContent = label;
  confLabel.textContent  = confidence.toFixed(1) + '%';
  resultPanel.classList.add('visible');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    confFill.style.width = Math.min(confidence, 100) + '%';
  }));

  const data = birdData[label] ?? defaultBirdData;
  birdCardIcon.textContent  = data.emoji;
  birdCardTitle.textContent = label;
  birdCardDesc.textContent  = data.desc;
  birdTagsEl.innerHTML = data.tags.map(t => `<span class="tag">${t}</span>`).join('');

  birdCard.style.display = 'block';
  void birdCard.offsetHeight;
  birdCard.classList.add('visible');
  resetRow.classList.add('visible');

  setTimeout(() => {
    resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 200);
}

// ── Hide results ───────────────────────────────
function hideResults() {
  resultPanel.classList.remove('visible');
  birdCard.classList.remove('visible');
  resetRow.classList.remove('visible');
  confFill.style.width = '0%';
  setTimeout(() => {
    if (!birdCard.classList.contains('visible')) birdCard.style.display = 'none';
  }, 600);
}

// ── Reset ──────────────────────────────────────
resetBtn.addEventListener('click', () => {
  closeCamera();
  hideResults();
  imgEl.style.display     = 'none';
  imgEl.src               = '';
  idleState.style.display = 'flex';
  previewZone.classList.remove('has-content');
  imageUpload.value       = '';
  confFill.style.width    = '0%';
});


/* ═══════════════════════════════════════════════
   INIT — triggered by startup.js via 'avian:ready'
   NOT window.load — ensures splash has finished
═══════════════════════════════════════════════ */
function appInit() {
  loadModel();
  setupPWA();

  /* Handle ?action=camera shortcut */
  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'camera') {
    /* Wait until model is ready then open camera */
    const poll = setInterval(() => {
      if (isModelReady) {
        clearInterval(poll);
        cameraBtnEl.click();
      }
    }, 300);
    setTimeout(() => clearInterval(poll), 15000);
  }
}

/* Listen for startup.js signal */
window.addEventListener('avian:ready', appInit, { once: true });

/* Fallback: if startup.js is missing or errored, boot on window.load */
window.addEventListener('load', () => {
  // If startup.js already fired avian:ready before this script registered,
  // the flag will be set — boot immediately. Otherwise wait briefly.
  if (window.__avianReady) {
    appInit();
  } else {
    setTimeout(() => {
      if (!isModelReady && !model) {
        console.warn('[App] avian:ready never fired — booting directly');
        appInit();
      }
    }, 500);
  }
});


/* ═══════════════════════════════════════════════
   PWA — Install prompt, toasts, update UI
═══════════════════════════════════════════════ */
function setupPWA() {

  /* ── Update toast (from SW) ── */
  let pendingNewSW = null;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            pendingNewSW = sw;
            showUpdateToast(sw);
          } else if (sw.state === 'installed' && !navigator.serviceWorker.controller) {
            showToast('offlineToast', 'App is ready for offline use', 4000);
          }
        });
      });
    });

    /* Pick up SW that was found during startup.js */
    if (window.__swWaiting) {
      pendingNewSW = window.__swWaiting;
      showUpdateToast(pendingNewSW);
    }
  }

  const updateBtn = document.getElementById('updateBtn');
  if (updateBtn) {
    updateBtn.addEventListener('click', () => {
      if (pendingNewSW) {
        pendingNewSW.postMessage('SKIP_WAITING');
        navigator.serviceWorker.addEventListener('controllerchange',
          () => window.location.reload(), { once: true });
      }
    });
  }

  /* ── Install banner (A2HS) ── */
  let deferredPrompt = null;
  const banner     = document.getElementById('installBanner');
  const installBtn = document.getElementById('installBtn');
  const dismissBtn = document.getElementById('installDismiss');

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    if (sessionStorage.getItem('avian_install_dismissed')) return;
    setTimeout(() => { if (banner) banner.style.display = 'flex'; }, 3000);
  });

  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.style.display = 'none';
      if (outcome === 'accepted') showToast('offlineToast', 'Avian installed! 🎉', 4000);
    });
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.style.display = 'none';
      sessionStorage.setItem('avian_install_dismissed', '1');
    });
  }

  window.addEventListener('appinstalled', () => {
    if (banner) banner.style.display = 'none';
    deferredPrompt = null;
  });
}

/* ── Toast helpers ── */
function showUpdateToast(sw) {
  const toast = document.getElementById('updateToast');
  if (!toast) return;
  toast.style.display = 'flex';
  requestAnimationFrame(() => toast.classList.add('show'));
}

function showToast(id, message, duration = 3500) {
  const toast = document.getElementById(id);
  if (!toast) return;
  const msgEl = toast.querySelector('#toastMsg');
  if (msgEl && message) msgEl.textContent = message;
  toast.style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { toast.style.display = 'none'; }, 500);
  }, duration);
}
