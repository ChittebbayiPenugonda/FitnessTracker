firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ── State ────────────────────────────────────────────────────────────────────
let currentUser        = null;
let currentExerciseId  = null;
let currentExerciseGrp = null;
let progressChart      = null;
let selectedUnit       = 'lbs';
let activeGroup        = 'all';
let selectedNewGroup   = null;
let allExercises       = [];
let allGroups          = [];

// ── Auth ─────────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    showScreen('list');
    loadGroups();
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

// ── Groups ────────────────────────────────────────────────────────────────────
function loadGroups() {
  db.collection(userPath('groups'))
    .orderBy('createdAt')
    .onSnapshot(snap => {
      allGroups = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // If active group was deleted, fall back to All
      if (activeGroup !== 'all' && !allGroups.find(g => g.id === activeGroup)) {
        activeGroup = 'all';
      }
      renderTabs();
      renderGroupPicker();
    }, console.error);
}

function renderTabs() {
  const bar = $('tab-bar');
  bar.innerHTML = `
    <button class="tab ${activeGroup === 'all' ? 'active' : ''}" data-group="all">All</button>
    ${allGroups.map(g =>
      `<button class="tab ${activeGroup === g.id ? 'active' : ''}" data-group="${g.id}">${g.name}</button>`
    ).join('')}
    <button class="tab tab-add" id="add-group-tab-btn" aria-label="Manage groups">+</button>
  `;

  bar.querySelectorAll('.tab:not(.tab-add)').forEach(tab => {
    tab.addEventListener('click', () => {
      activeGroup = tab.dataset.group;
      if (activeGroup !== 'all') setNewGroup(activeGroup);
      renderTabs();
      renderExercises();
    });
  });

  $('add-group-tab-btn').addEventListener('click', openManageGroupsModal);
}

// ── Manage Groups Modal ───────────────────────────────────────────────────────
function openManageGroupsModal() {
  $('new-group-input').value = '';
  renderManageGroupsList();
  $('manage-groups-modal').classList.remove('hidden');
  setTimeout(() => $('new-group-input').focus(), 80);
}

function renderManageGroupsList() {
  const list = $('manage-groups-list');
  list.innerHTML = allGroups.map(g =>
    `<div class="manage-group-item">
      <span class="manage-group-name" data-gid="${g.id}">${g.name}</span>
      <button class="manage-group-delete" data-gid="${g.id}" data-gname="${g.name}" aria-label="Delete">×</button>
    </div>`
  ).join('');

  list.querySelectorAll('.manage-group-name').forEach(el => {
    el.addEventListener('click', () => renameGroup(el.dataset.gid, el.textContent));
  });
  list.querySelectorAll('.manage-group-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteGroup(btn.dataset.gid, btn.dataset.gname));
  });
}

async function renameGroup(groupId, currentName) {
  const newName = prompt('Rename group:', currentName)?.trim();
  if (!newName || newName === currentName) return;
  await db.collection(userPath('groups')).doc(groupId).update({ name: newName });
  // Update chip on detail screen if this group is currently shown
  if (currentExerciseGrp === groupId) {
    $('detail-group-chip').textContent = newName;
  }
}

async function deleteGroup(groupId, groupName) {
  const exSnap = await db.collection(userPath('exercises'))
    .where('group', '==', groupId).get();
  const count = exSnap.size;
  const msg = count > 0
    ? `Delete "${groupName}"? ${count} exercise${count !== 1 ? 's' : ''} will become ungrouped.`
    : `Delete "${groupName}"?`;
  if (!confirm(msg)) return;
  await db.collection(userPath('groups')).doc(groupId).delete();
  // renderManageGroupsList is called automatically via onSnapshot → renderTabs chain
  renderManageGroupsList();
}

$('cancel-manage-groups-btn').addEventListener('click', () => $('manage-groups-modal').classList.add('hidden'));
$('save-new-group-btn').addEventListener('click', saveNewGroup);
$('new-group-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewGroup(); });

async function saveNewGroup() {
  const name = $('new-group-input').value.trim();
  if (!name) return;
  $('new-group-input').value = '';
  const ref = await db.collection(userPath('groups')).add({
    name,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  activeGroup = ref.id;
  setNewGroup(ref.id);
}

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
    const label = allGroups.find(g => g.id === activeGroup)?.name ?? '';
    list.innerHTML = `<div class="state-msg">${label ? `No ${label} exercises yet.` : 'No exercises yet.'}\nTap + to add one.</div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach(ex => list.appendChild(buildExerciseCard(ex)));
}

function buildExerciseCard(ex) {
  const card = document.createElement('div');
  const doneToday = ex.lastLoggedDate === todayStr();
  card.className = 'exercise-card' + (doneToday ? ' done-today' : '');
  const safeName = ex.name.replace(/'/g, "\\'");
  card.innerHTML = `
    <div class="card-body" onclick="openDetail('${ex.id}', '${safeName}', '${ex.group ?? ''}')">
      <span class="card-name">${ex.name}</span>
      <span class="card-last">${ex.lastLog ?? 'No logs yet'}</span>
    </div>
    <button class="card-quick-log ${doneToday ? 'card-quick-log--done' : ''}" aria-label="Log set"
            onclick="openLogModal('${ex.id}', '${safeName}')">${doneToday ? '✓' : '+'}</button>
  `;
  return card;
}

// ── Add Exercise ──────────────────────────────────────────────────────────────
$('add-exercise-fab').addEventListener('click', () => {
  $('new-exercise-input').value = '';
  renderGroupPicker();
  $('add-modal').classList.remove('hidden');
  setTimeout(() => $('new-exercise-input').focus(), 80);
});

$('cancel-add-btn').addEventListener('click', () => $('add-modal').classList.add('hidden'));
$('save-exercise-btn').addEventListener('click', saveExercise);
$('new-exercise-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveExercise(); });

function renderGroupPicker() {
  const picker = $('group-picker');
  if (allGroups.length === 0) {
    picker.innerHTML = '<span style="color:var(--muted);font-size:13px">No groups yet — create one with the + tab</span>';
    return;
  }
  // Default selectedNewGroup to activeGroup if valid, else first group
  if (!selectedNewGroup || !allGroups.find(g => g.id === selectedNewGroup)) {
    selectedNewGroup = activeGroup !== 'all' ? activeGroup : allGroups[0]?.id;
  }
  picker.innerHTML = allGroups.map(g =>
    `<button class="group-btn ${selectedNewGroup === g.id ? 'active' : ''}"
             data-group="${g.id}">${g.name}</button>`
  ).join('');
  picker.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', () => setNewGroup(btn.dataset.group));
  });
}

function setNewGroup(groupId) {
  selectedNewGroup = groupId;
  document.querySelectorAll('.group-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.group === groupId);
  });
}

async function saveExercise() {
  const name = $('new-exercise-input').value.trim();
  if (!name || !selectedNewGroup) return;
  $('add-modal').classList.add('hidden');
  await db.collection(userPath('exercises')).add({
    name,
    group: selectedNewGroup,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// ── Exercise Detail ───────────────────────────────────────────────────────────
function openDetail(id, name, groupId) {
  currentExerciseId  = id;
  currentExerciseGrp = groupId;
  $('detail-name').textContent = name;

  const groupName = allGroups.find(g => g.id === groupId)?.name ?? '';
  $('detail-group-chip').textContent = groupName;

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

$('detail-log-btn').addEventListener('click', () => {
  openLogModal(currentExerciseId, $('detail-name').textContent);
});

// ── Move Exercise ─────────────────────────────────────────────────────────────
$('move-exercise-btn').addEventListener('click', () => {
  const list = $('move-group-list');
  const others = allGroups.filter(g => g.id !== currentExerciseGrp);

  if (others.length === 0) {
    list.innerHTML = '<div class="state-msg">No other groups.\nCreate one with the + tab first.</div>';
  } else {
    list.innerHTML = others.map(g =>
      `<button class="move-group-btn" data-gid="${g.id}" data-gname="${g.name}">${g.name}</button>`
    ).join('');
    list.querySelectorAll('.move-group-btn').forEach(btn => {
      btn.addEventListener('click', () => moveExercise(btn.dataset.gid, btn.dataset.gname));
    });
  }
  $('move-modal').classList.remove('hidden');
});

$('cancel-move-btn').addEventListener('click', () => $('move-modal').classList.add('hidden'));

async function moveExercise(groupId, groupName) {
  $('move-modal').classList.add('hidden');
  currentExerciseGrp = groupId;
  $('detail-group-chip').textContent = groupName;
  await db.collection(userPath('exercises')).doc(currentExerciseId).update({ group: groupId });
}

// ── Delete Exercise ───────────────────────────────────────────────────────────
$('delete-exercise-btn').addEventListener('click', async () => {
  if (!confirm(`Delete "${$('detail-name').textContent}" and all its logs? This can't be undone.`)) return;

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
      <div class="log-item log-item-tap" data-log-id="${log.id}">
        <span class="log-weight">${log.weight} ${log.unit ?? 'lbs'}</span>
        <span class="log-reps">${log.reps} reps</span>
        <span class="log-time">${date ? fmtTime(date) : ''}</span>
        <span class="log-edit-hint">edit</span>
      </div>`;
  }).join('');

  // Attach tap handlers
  container.querySelectorAll('.log-item-tap').forEach(item => {
    item.addEventListener('click', () => {
      const log = logs.find(l => l.id === item.dataset.logId);
      if (log) openEditLogModal(log);
    });
  });
}

// ── Edit Log Modal ────────────────────────────────────────────────────────────
let editingLogId   = null;
let editingLogUnit = 'lbs';

function openEditLogModal(log) {
  editingLogId   = log.id;
  editingLogUnit = log.unit ?? 'lbs';
  $('edit-weight-input').value = log.weight;
  $('edit-reps-input').value   = log.reps;
  document.querySelectorAll('.edit-unit-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.unit === editingLogUnit);
  });
  $('edit-log-modal').classList.remove('hidden');
}

document.querySelectorAll('.edit-unit-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    editingLogUnit = btn.dataset.unit;
    document.querySelectorAll('.edit-unit-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.unit === editingLogUnit));
  });
});

$('cancel-edit-log-btn').addEventListener('click', () => $('edit-log-modal').classList.add('hidden'));

$('save-edit-log-btn').addEventListener('click', async () => {
  const weight = parseFloat($('edit-weight-input').value);
  const reps   = parseInt($('edit-reps-input').value, 10);
  if (isNaN(weight) || weight < 0 || isNaN(reps) || reps < 1) return;

  $('edit-log-modal').classList.add('hidden');
  await db.collection(userPath('logs')).doc(editingLogId).update({ weight, reps, unit: editingLogUnit });
  loadDetail(currentExerciseId);
});

$('delete-log-btn').addEventListener('click', async () => {
  if (!confirm('Delete this log entry?')) return;
  $('edit-log-modal').classList.add('hidden');
  await db.collection(userPath('logs')).doc(editingLogId).delete();
  loadDetail(currentExerciseId);
});

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
  batch.update(exRef, { lastLog, lastLoggedAt: ts, lastLoggedDate: todayStr() });
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
['log-modal', 'add-modal', 'manage-groups-modal', 'move-modal', 'edit-log-modal'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).classList.add('hidden'); });
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
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Seed (run once from browser console: seedData()) ─────────────────────────
const SEED = [
  { name: 'Inclined Smith Machine Bench Press', group: 'upper', weight: 65,  reps: 7,  date: '2026-04-23' },
  { name: 'Seated Rows',                        group: 'upper', weight: 145, reps: 7,  date: '2026-04-23' },
  { name: 'Lat Pulldown',                       group: 'upper', weight: 150, reps: 7,  date: '2026-04-23' },
  { name: 'Weighted Dips',                      group: 'upper' },
  { name: 'Pec Fly',                            group: 'upper', weight: 140, reps: 7,  date: '2026-04-23' },
  { name: 'Anterior Fly',                       group: 'upper' },
  { name: 'Regular Press',                      group: 'upper', weight: 150, reps: 10, date: '2026-04-20' },
  { name: 'Shoulder Press',                     group: 'arms',  weight: 125, reps: 7,  date: '2026-04-22' },
  { name: 'Bench Incline Dumbbell Curls',       group: 'arms',  weight: 40,  reps: 10, date: '2026-03-16' },
  { name: 'Overhead Tricep Extension',          group: 'arms',  weight: 50,  reps: 7,  date: '2026-04-10' },
  { name: 'Cable Lateral Raises',               group: 'arms',  weight: 30,  reps: 6,  date: '2026-02-22' },
  { name: 'Tricep Pushdown',                    group: 'arms',  weight: 130, reps: 7,  date: '2026-03-16' },
  { name: 'Preacher Curls',                     group: 'arms',  weight: 120, reps: 8,  date: '2026-03-16' },
  { name: 'Hammer Curls',                       group: 'arms',  weight: 35,  reps: 13, date: '2026-02-05' },
  { name: 'Leg Press',                          group: 'legs',  weight: 260, reps: 9,  date: '2026-04-21' },
  { name: 'Calf Extensions',                    group: 'legs' },
  { name: 'Hamstring Curls',                    group: 'legs',  weight: 110, reps: 7,  date: '2026-04-23' },
  { name: 'Leg Extensions',                     group: 'legs',  weight: 120, reps: 7,  date: '2026-04-23' },
  { name: 'Ab Crunch',                          group: 'legs',  weight: 130, reps: 6,  date: '2026-04-23' },
  { name: 'Leg Raises',                         group: 'legs' },
];

window.seedData = async function () {
  if (!currentUser) { console.error('Not signed in'); return; }
  const existing = await db.collection(userPath('exercises')).limit(1).get();
  if (!existing.empty) { console.warn('Exercises already exist — skipping.'); return; }

  // Create groups first with stable IDs
  const groupBatch = db.batch();
  const base = Date.now();
  [{ id: 'upper', name: 'Upper Body' }, { id: 'arms', name: 'Arms' }, { id: 'legs', name: 'Legs & Abs' }]
    .forEach(({ id, name }, i) => {
      groupBatch.set(db.collection(userPath('groups')).doc(id), {
        name, createdAt: firebase.firestore.Timestamp.fromMillis(base + i)
      });
    });
  await groupBatch.commit();

  console.log('Seeding exercises…');
  for (const ex of SEED) {
    const ts      = firebase.firestore.Timestamp.fromDate(new Date(ex.date ?? '2026-04-23'));
    const lastLog = ex.weight != null ? `${ex.weight} lbs × ${ex.reps} reps` : null;
    const exRef   = await db.collection(userPath('exercises')).add({
      name: ex.name, group: ex.group, createdAt: ts,
      ...(lastLog && { lastLog, lastLoggedAt: ts })
    });
    if (ex.weight != null) {
      await db.collection(userPath('logs')).add({
        exerciseId: exRef.id, weight: ex.weight, reps: ex.reps, unit: 'lbs', timestamp: ts
      });
    }
  }
  console.log('Done!');
};
