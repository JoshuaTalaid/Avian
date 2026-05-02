/* ═══════════════════════════════════════════════
   AVIAN — Bird Identifier · script.js
   Drop-in replacement — works with your
   model/model.json + model/metadata.json
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
// Matches your existing birdInfo keys exactly,
// extended with emoji + tags for the new card UI.
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
    emoji: '🐦‍⬛',
    desc:  "A highly intelligent black bird known for problem-solving and loud cawing.",
    tags:  ['Corvidae', 'Intelligent', 'Adaptable']
  },
  "Sparrow": {
    emoji: '🐦',
    desc:  "A small, social bird often found near humans, usually in flocks.",
    tags:  ['Passeridae', 'Passerine', 'Social']
  }
};

// Fallback for labels not in our database
const defaultBirdData = {
  emoji: '🦅',
  desc:  'A fascinating bird species identified by the AI model. Birds are warm-blooded vertebrates defined by their feathers, beaks, and adaptations for flight.',
  tags:  ['Aves', 'Vertebrate', 'Warm-blooded']
};

// ── Load model ─────────────────────────────────
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
    loadingVeil.querySelector('p').textContent = 'Failed to load model — refresh to retry.';
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

// ── Ripple helper ──────────────────────────────
function spawnRipple(e, btn) {
  const rect = btn.getBoundingClientRect();
  const x = (e.clientX ?? rect.left + rect.width  / 2) - rect.left;
  const y = (e.clientY ?? rect.top  + rect.height / 2) - rect.top;
  const r = Math.max(rect.width, rect.height);
  const rip = document.createElement('span');
  rip.className = 'ripple';
  rip.style.cssText = `width:${r}px;height:${r}px;left:${x - r/2}px;top:${y - r/2}px`;
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
  idleState.style.display  = 'none';
  video.style.display      = 'none';
  imgEl.src                = src;
  imgEl.style.display      = 'block';
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
    video.srcObject  = cameraStream;
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

  // Show scanning animation
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

  // Find top result
  let maxVal = 0, maxIdx = 0;
  predValues.forEach((v, i) => { if (v > maxVal) { maxVal = v; maxIdx = i; } });

  const label      = labels[maxIdx] ?? 'Unknown Bird';
  const confidence = maxVal * 100;

  showResult(label, confidence);
}

// ── Show result ────────────────────────────────
function showResult(label, confidence) {
  // Result panel
  resultText.textContent = label;
  confLabel.textContent  = confidence.toFixed(1) + '%';
  resultPanel.classList.add('visible');

  // Animate confidence bar after a tick (allows CSS transition)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      confFill.style.width = Math.min(confidence, 100) + '%';
    });
  });

  // Bird info card
  const data = birdData[label] ?? defaultBirdData;
  birdCardIcon.textContent  = data.emoji;
  birdCardTitle.textContent = label;
  birdCardDesc.textContent  = data.desc;

  // Tags
  birdTagsEl.innerHTML = data.tags
    .map(t => `<span class="tag">${t}</span>`)
    .join('');

  // Animate card in
  birdCard.style.display = 'block';
  // Force reflow before adding visible class
  void birdCard.offsetHeight;
  birdCard.classList.add('visible');

  // Reset button
  resetRow.classList.add('visible');

  // Smooth scroll to result
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

  // Wait for fade-out then hide card DOM
  setTimeout(() => {
    if (!birdCard.classList.contains('visible')) {
      birdCard.style.display = 'none';
    }
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

// ── Init ───────────────────────────────────────
window.addEventListener('load', loadModel);
