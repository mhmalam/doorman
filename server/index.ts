try {
  process.loadEnvFile(); // .env in project root; absent in fresh clones
} catch {}

import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { AsanaError, asanaFetch, asanaFetchAll, snapshotProject } from './asana';
import { ApplyRequest, BuildRequest, getRun, startApply, startBuild } from './build';

const app = express();
app.use(express.json({ limit: '5mb' }));

const DATA_DIR = path.resolve('data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
mkdirSync(SNAPSHOT_DIR, { recursive: true });
mkdirSync(path.join(DATA_DIR, 'manifests'), { recursive: true });

function sendAsanaError(res: express.Response, err: unknown) {
  if (err instanceof AsanaError) {
    res.status(err.status).json(err.body);
  } else {
    res.status(500).json({ errors: [{ message: String(err) }] });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasToken: !!process.env.ASANA_TOKEN });
});

// ---------------------------------------------------------------------------
// Auth: single shared password (APP_PASSWORD). When set, every /api route
// except /api/login and /api/health requires the session cookie. When unset
// (local dev), auth is disabled.
// ---------------------------------------------------------------------------

const sessionToken = () =>
  createHmac('sha256', process.env.APP_PASSWORD ?? '').update('doorman-session-v1').digest('hex');

function readCookie(req: express.Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function isAuthed(req: express.Request): boolean {
  if (!process.env.APP_PASSWORD) return true;
  const cookie = readCookie(req, 'doorman_auth');
  if (!cookie) return false;
  const expected = sessionToken();
  return (
    cookie.length === expected.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(expected))
  );
}

app.post('/api/login', (req, res) => {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    res.json({ ok: true });
    return;
  }
  if (typeof req.body?.password === 'string' && req.body.password === password) {
    res.setHeader(
      'Set-Cookie',
      `doorman_auth=${sessionToken()}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
    );
    res.json({ ok: true });
    return;
  }
  // Slow down guessing.
  setTimeout(() => res.status(401).json({ errors: [{ message: 'Wrong password' }] }), 700);
});

app.get('/api/me', (req, res) => {
  if (isAuthed(req)) res.json({ ok: true });
  else res.status(401).json({ errors: [{ message: 'Not signed in' }] });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/health' || isAuthed(req)) {
    next();
    return;
  }
  res.status(401).json({ errors: [{ message: 'Not signed in' }] });
});

// Read-only Asana passthrough (GET only — mutations go through /api/build & /api/ops).
app.get('/api/asana/*', async (req, res) => {
  try {
    const asanaPath = req.originalUrl.replace(/^\/api\/asana/, '');
    res.json(await asanaFetch(asanaPath));
  } catch (err) {
    sendAsanaError(res, err);
  }
});

// Full project snapshot: sections + tasks, paginated; persisted for undo.
app.get('/api/project/:gid/snapshot', async (req, res) => {
  try {
    const snapshot = await snapshotProject(req.params.gid);
    const file = path.join(
      SNAPSHOT_DIR,
      `${req.params.gid}-${Date.now()}.json`,
    );
    writeFileSync(file, JSON.stringify(snapshot, null, 2));
    res.json({ ...snapshot, savedTo: path.basename(file) });
  } catch (err) {
    sendAsanaError(res, err);
  }
});

// Sample library so the field browser is usable before a token is configured.
const SAMPLE_FIELDS = [
  {
    gid: 'sample-door-type', name: 'Door Type', type: 'enum',
    enum_options: [
      { gid: 'sample-dt-room', name: 'Room Door', color: 'blue' },
      { gid: 'sample-dt-building', name: 'Building Door', color: 'red' },
      { gid: 'sample-dt-ra', name: 'RA Room', color: 'green' },
    ],
  },
  {
    gid: 'sample-door-access', name: 'Door Access', type: 'enum',
    enum_options: [
      { gid: 'sample-da-ns', name: 'Not Started', color: 'cool-gray' },
      { gid: 'sample-da-ip', name: 'In Progress', color: 'yellow' },
      { gid: 'sample-da-done', name: 'Complete', color: 'green' },
    ],
  },
  { gid: 'sample-sign-qty', name: 'Sign Quantity', type: 'number' },
  { gid: 'sample-notes', name: 'Notes', type: 'text' },
];

// The master occupancy report kept in the project folder, pre-parsed to rows
// so the Insert Rooms picker can offer it without an upload.
app.get('/api/occupancy', (_req, res) => {
  const file = process.env.OCCUPANCY_FILE ?? 'Occupancy Graph All Buildings.xlsx';
  const full = path.resolve(file);
  if (!existsSync(full)) {
    res.status(404).json({ errors: [{ message: `Occupancy file not found: ${file}` }] });
    return;
  }
  try {
    const wb = XLSX.read(readFileSync(full));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
    res.json({ name: path.basename(full), rows });
  } catch (err) {
    res.status(500).json({ errors: [{ message: String(err) }] });
  }
});

// Organization custom-field library (for the "+" column browser). Tries the
// configured workspace first, then every workspace the token can see — field
// libraries are premium-gated per workspace (guest access returns 402).
app.get('/api/fields', async (_req, res) => {
  if (!process.env.ASANA_TOKEN) {
    res.json({ mock: true, fields: SAMPLE_FIELDS });
    return;
  }
  try {
    const me = await asanaFetch('/users/me?opt_fields=workspaces.name');
    const all: Array<{ gid: string; name: string }> = me.data.workspaces ?? [];
    const preferred = process.env.ASANA_WORKSPACE_GID;
    const candidates = [
      ...all.filter(w => w.gid === preferred),
      ...all.filter(w => w.gid !== preferred),
    ];
    let lastErr: unknown = new Error('No workspaces visible to this token');
    for (const ws of candidates) {
      try {
        const raw = await asanaFetchAll(
          `/workspaces/${ws.gid}/custom_fields?limit=100&opt_fields=name,resource_subtype,enum_options.name,enum_options.color,description`,
        );
        res.json({
          mock: false,
          workspace: ws.name,
          fields: raw.map((f: any) => ({
            gid: f.gid,
            name: f.name,
            type: f.resource_subtype,
            enum_options: f.enum_options?.map((o: any) => ({ gid: o.gid, name: o.name, color: o.color })),
            description: f.description,
          })),
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    sendAsanaError(res, lastErr);
  } catch (err) {
    sendAsanaError(res, err);
  }
});

// Create a real project from staged sections/tasks. Returns a runId to poll.
app.post('/api/build', (req, res) => {
  if (!process.env.ASANA_TOKEN) {
    res.status(400).json({ errors: [{ message: 'ASANA_TOKEN is not set on the server — add it to .env and restart.' }] });
    return;
  }
  const body = req.body as BuildRequest;
  if (!body?.title || !Array.isArray(body.sections)) {
    res.status(400).json({ errors: [{ message: 'Invalid build request' }] });
    return;
  }
  res.json({ runId: startBuild(body) });
});

// Apply staging to an EXISTING project (update + create, never delete).
app.post('/api/apply', (req, res) => {
  if (!process.env.ASANA_TOKEN) {
    res.status(400).json({ errors: [{ message: 'ASANA_TOKEN is not set on the server — add it to .env and restart.' }] });
    return;
  }
  const body = req.body as ApplyRequest;
  if (!body?.projectGid || !Array.isArray(body.sections)) {
    res.status(400).json({ errors: [{ message: 'Invalid apply request' }] });
    return;
  }
  res.json({ runId: startApply(body) });
});

app.get('/api/build/:runId', (req, res) => {
  const run = getRun(req.params.runId);
  if (!run) {
    res.status(404).json({ errors: [{ message: 'Unknown run' }] });
    return;
  }
  res.json(run);
});

// Production: serve the built frontend (vite build → dist/).
const dist = path.resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`Doorman proxy listening on :${port} (token ${process.env.ASANA_TOKEN ? 'present' : 'MISSING'})`);
});
