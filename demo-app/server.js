// ag-qrew demo task-manager — intentionally buggy target-under-test.
// See docs/PLANTED_BUGS.md for the 4 planted defects (marked BUG #n below).
const express = require('express');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ---- In-memory data store -------------------------------------------------
let nextId = 4;
const tasks = [
  { id: 1, title: 'Set up project repo', done: true, ownerRole: 'admin' },
  { id: 2, title: 'Write API tests', done: false, ownerRole: 'user' },
  { id: 3, title: 'Review pull requests', done: false, ownerRole: 'admin' },
];

// BUG #4 (data-refresh): a SEPARATE stale snapshot used ONLY by GET /tasks (HTML).
// It is refreshed on CREATE but NEVER on DELETE, so the HTML page can show
// tasks that the API has already removed.
let renderedTasks = [...tasks];

// Valid credentials.
const USERS = {
  'admin@demo.test': { password: 'admin123', role: 'admin' },
  'user@demo.test': { password: 'user123', role: 'standard' },
};

const MAX_TITLE_LENGTH = 200; // documented limit (see openapi.yaml)

// ---- Auth helper ----------------------------------------------------------
function requireAuth(req, res) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'missing or invalid Authorization header' });
    return false;
  }
  return true;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ===========================================================================
// AUTH module
// ===========================================================================
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = USERS[email];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  const token = Buffer.from(String(email)).toString('base64');
  return res.status(200).json({ token, role: user.role });
});

// ===========================================================================
// TASKS module (REST JSON API)
// ===========================================================================

// GET /api/tasks — ALWAYS reflects the true current state of the array.
app.get('/api/tasks', (req, res) => {
  if (!requireAuth(req, res)) return;
  return res.status(200).json(tasks);
});

// POST /api/tasks
app.post('/api/tasks', (req, res) => {
  if (!requireAuth(req, res)) return;
  const { title, done } = req.body || {};

  // BUG #3 (contract / 200-on-error): missing/empty title returns HTTP 200
  // with an error body instead of the correct 400. No task is created.
  if (!title || String(title).trim() === '') {
    return res.status(200).json({ error: 'title is required' });
  }

  // BUG #2 (boundary): the documented maxLength:200 is NOT enforced.
  // A 201-char title is accepted and stored (should be 400). No length check here.

  const task = {
    id: nextId++,
    title: String(title),
    done: Boolean(done),
    ownerRole: 'user',
  };
  tasks.push(task);

  // Snapshot refreshed on CREATE only (feeds BUG #4).
  renderedTasks = [...tasks];

  return res.status(201).json(task);
});

// PUT /api/tasks/:id
app.put('/api/tasks/:id', (req, res) => {
  if (!requireAuth(req, res)) return;
  const id = Number(req.params.id);
  const task = tasks.find((t) => t.id === id);
  if (!task) {
    return res.status(404).json({ error: 'task not found' });
  }
  const { title, done } = req.body || {};
  if (title !== undefined) task.title = String(title);
  if (done !== undefined) task.done = Boolean(done);
  return res.status(200).json({ task });
});

// DELETE /api/tasks/:id — array IS updated correctly here...
app.delete('/api/tasks/:id', (req, res) => {
  if (!requireAuth(req, res)) return;
  const id = Number(req.params.id);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'task not found' });
  }
  tasks.splice(idx, 1);

  // BUG #4 (data-refresh): renderedTasks is deliberately NOT updated here,
  // so GET /tasks (HTML) keeps showing the deleted task.

  return res.status(200).json({ deleted: true });
});

// ===========================================================================
// HTML pages (server-rendered strings)
// ===========================================================================

// Shared page styling (self-contained; no external assets).
const PAGE_STYLE = `<style>
  :root { --bg1:#6366f1; --bg2:#8b5cf6; --card:#fff; --ink:#1e2233; --muted:#6b7280; --accent:#6366f1; --line:#e6e7ef; }
  * { box-sizing:border-box; }
  body { font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; margin:0; min-height:100vh; color:var(--ink);
    background:linear-gradient(135deg,var(--bg1),var(--bg2)); display:flex; align-items:flex-start; justify-content:center; padding:48px 16px; }
  .card { background:var(--card); width:100%; max-width:560px; border-radius:16px; padding:32px; box-shadow:0 20px 50px rgba(30,20,80,.3); }
  .brand { display:flex; align-items:center; gap:10px; margin:0 0 2px; }
  .brand .dot { width:30px; height:30px; border-radius:9px; background:linear-gradient(135deg,var(--bg1),var(--bg2)); box-shadow:0 4px 10px rgba(99,102,241,.4); }
  h1 { font-size:22px; margin:0; letter-spacing:-.01em; }
  .sub { color:var(--muted); margin:4px 0 26px; font-size:14px; }
  label { display:block; font-size:13px; font-weight:600; color:var(--muted); margin-bottom:6px; }
  input { width:100%; padding:11px 13px; font-size:15px; border:1px solid var(--line); border-radius:10px; margin-bottom:16px; outline:none; transition:border .15s,box-shadow .15s; }
  input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(99,102,241,.16); }
  button { background:linear-gradient(135deg,var(--bg1),var(--bg2)); color:#fff; border:0; padding:11px 18px; font-size:15px; font-weight:600; border-radius:10px; cursor:pointer; transition:filter .15s,transform .05s; }
  button:hover { filter:brightness(1.08); } button:active { transform:translateY(1px); }
  h2 { font-size:15px; margin:26px 0 12px; color:var(--ink); }
  ul { list-style:none; padding:0; margin:0; }
  li { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 14px; border:1px solid var(--line); border-radius:10px; margin-bottom:8px; background:#fafaff; }
  .pill { font-size:12px; font-weight:700; padding:3px 11px; border-radius:999px; white-space:nowrap; }
  .pill.done { background:#dcfce7; color:#15803d; } .pill.pending { background:#fef3c7; color:#b45309; }
  .who { color:var(--muted); font-size:12px; }
  .addrow { display:flex; gap:8px; } .addrow input { margin:0; }
  a { color:var(--accent); text-decoration:none; font-weight:600; font-size:14px; } a:hover { text-decoration:underline; }
  .foot { margin-top:20px; text-align:center; }
</style>`;

// GET / — login page
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo Task Manager — Sign In</title>${PAGE_STYLE}</head>
<body>
  <div class="card">
    <div class="brand"><span class="dot"></span><h1>Demo Task Manager</h1></div>
    <p class="sub">Sign in to manage your tasks</p>
    <form id="login-form">
      <label for="email">Email</label>
      <input type="email" name="email" id="email" placeholder="admin@demo.test">
      <label for="password">Password</label>
      <input type="password" name="password" id="password" placeholder="••••••••">
      <button type="submit" id="signin">Sign In</button>
      <p id="login-error" style="display:none;color:#dc2626;font-size:13px;margin:10px 0 0"></p>
    </form>
    <div class="foot"><a href="/tasks">Go to tasks &rarr;</a></div>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.getElementById('login-error');
      err.style.display = 'none';
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.token) {
        localStorage.setItem('token', body.token);
        location.href = '/tasks';
      } else {
        err.textContent = body.error || 'Invalid email or password.';
        err.style.display = 'block';
      }
    });
  </script>
</body>
</html>`);
});

// GET /tasks — tasks page (rendered from the STALE renderedTasks snapshot).
app.get('/tasks', (req, res) => {
  // BUG #1 (UI): the count is never populated — literal "undefined" is rendered.
  let count; // intentionally left undefined

  const rows = renderedTasks
    .map(
      (t) =>
        `<li data-id="${t.id}"><span>${escapeHtml(t.title)} <span class="who">(${escapeHtml(t.ownerRole)})</span></span>` +
        `<span class="pill ${t.done ? 'done' : 'pending'}">${t.done ? 'done' : 'pending'}</span></li>`
    )
    .join('\n      ');

  res.type('html').send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Demo Task Manager — Tasks</title>${PAGE_STYLE}</head>
<body>
  <div class="card">
    <div class="brand"><span class="dot"></span><h1>Demo Task Manager</h1></div>
    <p class="sub">Your tasks</p>
    <h2>Tasks (${count})</h2>
    <ul id="task-list">
      ${rows}
    </ul>
    <section id="add-task">
      <h2>Add Task</h2>
      <div class="addrow">
        <input type="text" id="new-title" placeholder="New task title">
        <button type="button" id="add-btn">Add</button>
      </div>
    </section>
    <div class="foot"><a href="/">&larr; Sign out</a></div>
  </div>
</body>
</html>`);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ag-qrew demo app listening on http://localhost:${PORT}`);
  });
}

module.exports = app;
