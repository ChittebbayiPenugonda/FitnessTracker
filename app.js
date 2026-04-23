firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── State ────────────────────────────────────────────────────────────────────
let currentUser       = null;
let currentExerciseId = null;
let progressChart     = null;
let selectedUnit      = 'lbs';
let activeGroup       = 'all';
let selectedNewGroup  = 'upper';
let allExercises      = [];

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

// ── Tabs ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeGroup = tab.dataset.group;
    // Default new exercise group to the active tab (if not "all")
    if (activeGroup !== 'all') setNewGroup(activeGroup);
    renderExercises();
  });
});

// ── Exercise List ─────────────────────────────────────────────────────────────
function loadExercises() {
  db.collection(userPath('exercises'))
    .orderBy('name')
    .onSnapshot(snap => {
      allExercises = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderExercises();
    }, console.error);
}

function renderExercises() {
  const list = $('exercise-list');
  const filtered = activeGroup === 'all'
    ? allExercises
    : allExercises.filter(ex => ex.group === activeGroup);

  if (filtered.length === 0) {
    const label = { upper: 'Upper Body', arms: 'Arms', legs: 'Legs & Abs' }[activeGroup] ?? '';
    list.innerHTML = `<div class="state-msg">${label ? `No ${label} exercises yet.` : 'No exercises yet.'}\nTap + to add one.</div>`;
    return;
  }

  list.innerHTML = '';
  filtered.forEach(ex => list.appendChild(buildExerciseCard(ex)));
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

function setNewGroup(group) {
  selectedNewGroup = group;
  document.querySelectorAll('.group-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.group === group);
  });
}

document.querySelectorAll('.group-btn').forEach(btn => {
  btn.addEventListener('click', () => setNewGroup(btn.dataset.group));
});

async function saveExercise() {
  const name = $('new-exercise-input').value.trim();
  if (!name) return;
  $('add-modal').classList.add('hidden');
  await db.collection(userPath('exercises')).add({
    name,
    group: selectedNewGroup,
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
    .get();

  const logs = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0));
  renderChart(logs.slice().reverse());
  renderLogList(logs);
}

$('back-btn').addEventListener('click', () => {
  showScreen('list');
  destroyChart();
});

$('delete-exercise-btn').addEventListener('click', async () => {
  const name = $('detail-name').textContent;
  if (!confirm(`Delete "${name}" and all its logs? This can't be undone.`)) return;

  const logs = await db.collection(userPath('logs'))
    .where('exerciseId', '==', currentExerciseId)
    .get();

  const batch = db.batch();
  logs.docs.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection(userPath('exercises')).doc(currentExerciseId));
  await batch.commit();

  destroyChart();
  showScreen('list');
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
    const header = day !== lastDay ? `<div class="date-header">${day}</div>` : '';
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

  const snap = await db.collection(userPath('logs'))
    .where('exerciseId', '==', exerciseId)
    .get();

  if (!snap.empty) {
    const last = snap.docs
      .map(d => d.data())
      .sort((a, b) => (b.timestamp?.seconds ?? 0) - (a.timestamp?.seconds ?? 0))[0];
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

  const ts      = firebase.firestore.FieldValue.serverTimestamp();
  const logRef  = db.collection(userPath('logs')).doc();
  const exRef   = db.collection(userPath('exercises')).doc(currentExerciseId);
  const lastLog = `${weight} ${selectedUnit} × ${reps} reps`;

  const batch = db.batch();
  batch.set(logRef, { exerciseId: currentExerciseId, weight, reps, unit: selectedUnit, timestamp: ts });
  batch.update(exRef, { lastLog, lastLoggedAt: ts });
  await batch.commit();

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

// ── Seed ─────────────────────────────────────────────────────────────────────
// Run once from the browser console after signing in: seedData()
const SEED = [
  // Upper Body
  { name: 'Inclined Smith Machine Bench Press', group: 'upper', weight: 65,  reps: 7,  date: '2026-04-23' },
  { name: 'Seated Rows',                        group: 'upper', weight: 145, reps: 7,  date: '2026-04-23' },
  { name: 'Lat Pulldown',                        group: 'upper', weight: 150, reps: 7,  date: '2026-04-23' },
  { name: 'Weighted Dips',                       group: 'upper' },
  { name: 'Pec Fly',                             group: 'upper', weight: 140, reps: 7,  date: '2026-04-23' },
  { name: 'Anterior Fly',                        group: 'upper' },
  { name: 'Regular Press',                       group: 'upper', weight: 150, reps: 10, date: '2026-04-20' },
  // Arms
  { name: 'Shoulder Press',                      group: 'arms',  weight: 125, reps: 7,  date: '2026-04-22' },
  { name: 'Bench Incline Dumbbell Curls',        group: 'arms',  weight: 40,  reps: 10, date: '2026-03-16' },
  { name: 'Overhead Tricep Extension',           group: 'arms',  weight: 50,  reps: 7,  date: '2026-04-10' },
  { name: 'Cable Lateral Raises',                group: 'arms',  weight: 30,  reps: 6,  date: '2026-02-22' },
  { name: 'Tricep Pushdown',                     group: 'arms',  weight: 130, reps: 7,  date: '2026-03-16' },
  { name: 'Preacher Curls',                      group: 'arms',  weight: 120, reps: 8,  date: '2026-03-16' },
  { name: 'Hammer Curls',                        group: 'arms',  weight: 35,  reps: 13, date: '2026-02-05' },
  // Legs & Abs
  { name: 'Leg Press',                           group: 'legs',  weight: 260, reps: 9,  date: '2026-04-21' },
  { name: 'Calf Extensions',                     group: 'legs' },
  { name: 'Hamstring Curls',                     group: 'legs',  weight: 110, reps: 7,  date: '2026-04-23' },
  { name: 'Leg Extensions',                      group: 'legs',  weight: 120, reps: 7,  date: '2026-04-23' },
  { name: 'Ab Crunch',                           group: 'legs',  weight: 130, reps: 6,  date: '2026-04-23' },
  { name: 'Leg Raises',                          group: 'legs' },
];

window.seedData = async function () {
  if (!currentUser) { console.error('Not signed in'); return; }

  const existing = await db.collection(userPath('exercises')).limit(1).get();
  if (!existing.empty) {
    console.warn('Exercises already exist — skipping seed to avoid duplicates.');
    return;
  }

  console.log('Seeding…');
  for (const ex of SEED) {
    const ts      = ex.date ? firebase.firestore.Timestamp.fromDate(new Date(ex.date)) : firebase.firestore.Timestamp.now();
    const lastLog = ex.weight != null ? `${ex.weight} lbs × ${ex.reps} reps` : null;

    const exRef = await db.collection(userPath('exercises')).add({
      name: ex.name,
      group: ex.group,
      createdAt: ts,
      ...(lastLog && { lastLog, lastLoggedAt: ts })
    });

    if (ex.weight != null) {
      await db.collection(userPath('logs')).add({
        exerciseId: exRef.id,
        weight:     ex.weight,
        reps:       ex.reps,
        unit:       'lbs',
        timestamp:  ts
      });
    }
  }
  console.log('Done! All exercises seeded.');
};
