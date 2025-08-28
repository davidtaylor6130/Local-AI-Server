import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const QUEUE_URL = process.env.QUEUE_URL || 'http://queue:7000';
const AGENTS = (process.env.AGENTS || 'rag').split(',').map(s => s.trim()).filter(Boolean);
const AVG_JOB_SECONDS = Number(process.env.AVG_JOB_SECONDS || 30);
let AGENT_META = {};
try {
  if (process.env.AGENT_META) {
    AGENT_META = JSON.parse(process.env.AGENT_META);
  }
} catch (e) {
  console.warn('[dashboard] Failed to parse AGENT_META env; using defaults');
}
if (!AGENT_META['rag']) AGENT_META['rag'] = { icon: '🧠', description: 'Retrieval Augmented Generation' };

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: '*'} });

// Serve static built frontend (copied to /public)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Simple health
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Proxy helpers
async function queueGet(pathname, params) {
  const url = `${QUEUE_URL}${pathname}`;
  const r = await axios.get(url, { params });
  return r.data;
}
async function queuePost(pathname, params, data) {
  const url = `${QUEUE_URL}${pathname}`;
  const r = await axios.post(url, data || {}, { params });
  return r.data;
}
async function queueDelete(pathname, params) {
  const url = `${QUEUE_URL}${pathname}`;
  const r = await axios.delete(url, { params });
  return r.data;
}

// API endpoints
app.get('/api/stats', async (req, res) => {
  try {
    const data = await queueGet('/stats');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/control/state', async (req, res) => {
  try {
    const data = await queueGet('/control/state');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/control/pause', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queuePost('/control/pause', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/control/resume', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queuePost('/control/resume', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.delete('/api/jobs', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queueDelete('/jobs', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/agents', async (req, res) => {
  try {
    const [state, stats] = await Promise.all([
      queueGet('/control/state'),
      queueGet('/stats').catch(() => null),
    ]);
    const pausedSet = new Set(state.paused || []);
    const inflight = stats?.inflight || [];
    const metricsByAgent = stats?.metrics?.by_agent || {};
    const list = [];
    for (const name of AGENTS) {
      const meta = AGENT_META[name] || { icon: '🤖', description: '', title: undefined };
      let paused = pausedSet.has(name);
      // derive next job by scanning stats queues (no extra queue endpoints)
      const high = stats?.queues?.high || [];
      const low = stats?.queues?.low || [];
      let next = high.find(j => j.agent === name);
      let lane = next ? 'high' : null;
      if (!next) { next = low.find(j => j.agent === name); lane = next ? 'low' : null; }
      const position = next ? (lane === 'high' ? high.findIndex(j => j.id === next.id) : low.findIndex(j => j.id === next.id)) : null;
      const inflightCount = (metricsByAgent[name]?.inflight) || inflight.filter(j => j.agent === name).length;
      const startSlots = (position ?? 0) + (inflightCount > 0 ? 1 : 0);
      const etaSeconds = next ? (startSlots + 1) * AVG_JOB_SECONDS : null;
      list.push({
        name,
        paused,
        icon: meta.icon,
        description: meta.description,
        title: meta.title || name,
        nextTask: next || null,
        lane,
        position,
        eta_seconds: etaSeconds,
      });
    }
    res.json({ agents: list });
  } catch (e) {
    const agents = AGENTS.map(name => ({ name, paused: false, icon: (AGENT_META[name]?.icon)||'🤖', description: (AGENT_META[name]?.description)||'', title: (AGENT_META[name]?.title)||name, nextTask: null, eta_seconds: null }));
    res.json({ agents, warning: 'queue unavailable' });
  }
});

app.post('/api/control/skip_next', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queuePost('/control/skip_next', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/control/bring_forward', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queuePost('/control/bring_forward', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.post('/api/control/stop', async (req, res) => {
  try {
    const { agent } = req.query;
    if (!agent) return res.status(400).json({ error: 'agent required' });
    const data = await queuePost('/control/stop', { agent });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// Socket.io: push stats periodically
let latestStats = null;
let latestCtrl = { paused: [] };

async function refresh() {
  try {
    const [stats, ctrl] = await Promise.all([
      queueGet('/stats').catch(() => latestStats),
      queueGet('/control/state').catch(() => latestCtrl)
    ]);
    if (stats) {
      latestStats = stats;
      io.emit('stats', stats);
    }
    if (ctrl) {
      latestCtrl = ctrl;
      io.emit('control', ctrl);
    }
  } catch (_) {
    // ignore
  }
}

setInterval(refresh, 2000);

io.on('connection', (socket) => {
  if (latestStats) socket.emit('stats', latestStats);
  if (latestCtrl) socket.emit('control', latestCtrl);
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

server.listen(PORT, () => {
  console.log(`[dashboard] Server listening on :${PORT}, queue at ${QUEUE_URL}`);
});
