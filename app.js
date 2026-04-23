firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── State ────────────────────────────────────────────────────────────────────
let currentUser       = null;
let currentExerciseId = null;
let progressChart     = null;
let selectedUnit      = 'lbs';

// ── Auth ─────────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    showScreen('list');
    loadExercises();
  } else {
    showScreen('auth');
  }
});

$('google-signin-btn').addEventListener('click', () => {
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(console.error);
});

$('signout-btn').addEventListener('click', () => auth.signOut());

// ── Screens ──────────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $(`${name}-screen`).classList.remove('hidden');
}

// ── Exercise List ─────────────────────────────────────────────────────────────
function loadExercises() {
  const list = $('exercise-list');

  db.collection(userPath('exercises'))
    .orderBy('name')
    .onSnapshot(snap => {
      if (snap.empty) {
        list.innerHTML = '<div class="state-msg">No exercises yet.\nTap + to add one.</div>';
        return;
      }
      list.innerHTML = '';
      snap.forEach(doc => list.appendChild(buildExerciseCard({ id: doc.id, ...doc.data() })));
    }, console.error);
}

function buildExerciseCard(ex) {
  const card = document.createElement('div');
  card.className = 'exercise-card';

  const safeName = ex.name.replace(/'/g, "\\'");

  card.innerHTML = `
    <div class="card-body" onclick="openDetail('${ex.id}', '${safeName}')">
      <span class="card-name">${ex.name}</span>
      <span class="card-last">${ex.lastLog ?? 'No logs yet'}</span>
    </div>
    <button class="card-quick-log" aria-label="Log set"
            onclick="openLogModal('${ex.id}', '${safeName}')">+</button>
  `;
  return card;
}

// ── Add Exercise ──────────────────────────────────────────────────────────────
$('add-exercise-fab').addEventListener('click', () => {
  $('new-exercise-input').value = '';
  $('add-modal').classList.remove('hidden');
  setTimeout(() => $('new-exercise-input').focus(), 80);
});

$('cancel-add-btn').addEventListener('click', () => $('add-modal').classList.add('hidden'));

$('save-exercise-btn').addEventListener('click', saveExercise);
$('new-exercise-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveExercise(); });

async function saveExercise() {
  const name = $('new-exercise-input').value.trim();
  if (!name) return;

  $('add-modal').classList.add('hidden');
  await db.collection(userPath('exercises')).add({
    name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ── Exercise Detail ───────────────────────────────────────────────────────────
function openDetail(id, name) {
  currentExerciseId = id;
  $('detail-name').textContent = name;
  showScreen('detail');
  loadDetail(id);
}

async function loadDetail(exerciseId) {
  $('log-list').innerHTML = '<div class="state-msg">Loading…</div>';

  const snap = await db.collection(userPath('logs'))
    .where('exerciseId', '==', exerciseId)
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get();

  const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderChart(logs.slice().reverse()); // chart wants chronological order
  renderLogList(logs);
}

$('back-btn').addEventListener('click', () => {
  showScreen('list');
  destroyChart();
});

$('detail-log-btn').addEventListener('click', () => {
  openLogModal(currentExerciseId, $('detail-name').textContent);
});

// ── Chart ─────────────────────────────────────────────────────────────────────
function renderChart(logs) {
  const canvas = $('progress-chart');
  const empty  = $('chart-empty');

  destroyChart();

  if (logs.length === 0) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  const points = logs.map(log => ({
    x:    log.timestamp?.toDate() ?? new Date(),
    y:    log.weight,
    reps: log.reps,
    unit: log.unit ?? 'lbs'
  }));

  progressChart = new Chart(canvas, {
    type: 'line',
    plugins: [ChartDataLabels],
    data: {
      datasets: [{
        data: points,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.08)',
        pointBackgroundColor: '#f59e0b',
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.25,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => fmtDate(new Date(items[0].parsed.x)),
            label: ctx  => `${ctx.raw.y} ${ctx.raw.unit}  ×  ${ctx.raw.reps} reps`
          }
        },
        datalabels: {
          color: '#f59e0b',
          anchor: 'end',
          align: 'top',
          offset: 3,
          font: { size: 11, weight: '700' },
          formatter: val => `${val.reps}r`
        }
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day', displayFormats: { day: 'MMM d' } },
          ticks: { color: '#9ca3af', maxTicksLimit: 6, maxRotation: 0 },
          grid: { color: '#374151' }
        },
        y: {
          ticks: { color: '#9ca3af' },
          grid: { color: '#374151' }
        }
      }
    }
  });
}

function destroyChart() {
  if (progressChart) { progressChart.destroy(); progressChart = null; }
}

// ── Log List ─────────────────────────────────────────────────────────────────
function renderLogList(logs) {
  const container = $('log-list');

  if (logs.length === 0) {
    container.innerHTML = '<div class="state-msg">No logs yet</div>';
    return;
  }

  let lastDay = null;
  container.innerHTML = logs.map(log => {
    const date = log.timestamp?.toDate();
    const day  = date ? fmtDate(date) : 'Unknown date';
    const header = day !== lastDay
      ? `<div class="date-header">${day}</div>`
      : '';
    lastDay = day;

    return `${header}
      <div class="log-item">
        <span class="log-weight">${log.weight} ${log.unit ?? 'lbs'}</span>
        <span class="log-reps">${log.reps} reps</span>
        <span class="log-time">${date ? fmtTime(date) : ''}</span>
      </div>`;
  }).join('');
}

// ── Log Modal ─────────────────────────────────────────────────────────────────
async function openLogModal(exerciseId, exerciseName) {
  currentExerciseId = exerciseId;

  // Pre-fill with last logged values for this exercise
  const snap = await db.collection(userPath('logs'))
    .where('exerciseId', '==', exerciseId)
    .orderBy('timestamp', 'desc')
    .limit(1)
    .get();

  if (!snap.empty) {
    const last = snap.docs[0].data();
    $('weight-input').value = last.weight;
    $('reps-input').value   = last.reps;
    setUnit(last.unit ?? 'lbs');
  }

  $('log-modal-title').textContent = `Log — ${exerciseName}`;
  $('log-modal').classList.remove('hidden');
}

$('cancel-log-btn').addEventListener('click', () => $('log-modal').classList.add('hidden'));
$('save-log-btn').addEventListener('click', saveLog);

async function saveLog() {
  const weight = parseFloat($('weight-input').value);
  const reps   = parseInt($('reps-input').value, 10);
  if (isNaN(weight) || weight < 0 || isNaN(reps) || reps < 1) return;

  $('log-modal').classList.add('hidden');

  const ts       = firebase.firestore.FieldValue.serverTimestamp();
  const logRef   = db.collection(userPath('logs')).doc();
  const exRef    = db.collection(userPath('exercises')).doc(currentExerciseId);
  const lastLog  = `${weight} ${selectedUnit} × ${reps} reps`;

  const batch = db.batch();
  batch.set(logRef, { exerciseId: currentExerciseId, weight, reps, unit: selectedUnit, timestamp: ts });
  batch.update(exRef, { lastLog, lastLoggedAt: ts });
  await batch.commit();

  // Refresh detail if visible
  if (!$('detail-screen').classList.contains('hidden') && currentExerciseId) {
    loadDetail(currentExerciseId);
  }
}

// ── Steppers ─────────────────────────────────────────────────────────────────
document.querySelectorAll('.step-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(btn.dataset.target);
    const step  = parseFloat(btn.dataset.step);
    input.value = Math.max(0, (parseFloat(input.value) || 0) + step);
  });
});

// ── Unit Toggle ──────────────────────────────────────────────────────────────
function setUnit(unit) {
  selectedUnit = unit;
  document.querySelectorAll('.unit-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === unit);
  });
}
document.querySelectorAll('.unit-btn').forEach(btn => {
  btn.addEventListener('click', () => setUnit(btn.dataset.unit));
});

// ── Close modals on overlay tap ───────────────────────────────────────────────
['log-modal', 'add-modal'].forEach(id => {
  $(id).addEventListener('click', e => {
    if (e.target === $(id)) $(id).classList.add('hidden');
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function userPath(sub) { return `users/${currentUser.uid}/${sub}`; }

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
