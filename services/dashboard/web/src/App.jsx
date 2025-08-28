import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const socket = io();

function useSocketState(eventName, initial) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const handler = (data) => setState(data);
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
  }, [eventName]);
  return state;
}

function Header({ active, setActive }) {
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'queue', label: 'Queue' },
    { key: 'agents', label: 'Agents' },
  ];
  return (
    <div className="border-b bg-white">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="font-semibold text-lg">Local AI Dashboard</div>
        <div className="flex gap-2">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setActive(t.key)}
              className={`px-3 py-1.5 rounded ${active===t.key? 'bg-gray-900 text-white':'hover:bg-gray-100'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-1">{subtitle}</div>}
    </div>
  )
}

function Overview({ stats }) {
  const m = stats?.metrics || { queued_high: 0, queued_low: 0, inflight: 0, by_agent: {} };
  const agents = Object.entries(m.by_agent||{}).map(([name, v]) => ({ name, ...v }));
  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Queued (High)" value={m.queued_high||0} />
        <StatCard title="Queued (Low)" value={m.queued_low||0} />
        <StatCard title="In-Flight" value={m.inflight||0} />
      </div>
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b font-medium">By Agent</div>
        <div className="divide-y">
          {agents.length === 0 && <div className="p-4 text-gray-500">No agents yet</div>}
          {agents.map(a => (
            <div key={a.name} className="p-4 flex justify-between items-center">
              <div className="font-medium">{a.name}</div>
              <div className="flex gap-6 text-sm text-gray-600">
                <div>High: <span className="font-semibold">{a.queued_high||0}</span></div>
                <div>Low: <span className="font-semibold">{a.queued_low||0}</span></div>
                <div>In-Flight: <span className="font-semibold">{a.inflight||0}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QueueTable({ stats }) {
  const high = stats?.queues?.high || [];
  const low = stats?.queues?.low || [];
  const rows = useMemo(() => ([...high.map(j => ({ ...j, lane: 'high' })), ...low.map(j => ({ ...j, lane: 'low' }))]), [high, low]);
  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b font-medium">Queued Jobs</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Payload</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-6 text-center text-gray-500">Queue is empty</td></tr>
              )}
              {rows.map(j => (
                <tr key={j.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{j.id.slice(0,10)}…</td>
                  <td className="px-4 py-2">{j.agent}</td>
                  <td className="px-4 py-2">{j.model}</td>
                  <td className="px-4 py-2 capitalize">{j.priority}</td>
                  <td className="px-4 py-2 max-w-[480px]"><pre className="text-xs text-gray-700 truncate-2">{JSON.stringify(j.payload)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Agents() {
  const [agents, setAgents] = useState([]);
  const [stopped, setStopped] = useState({});
  const ctrl = useSocketState('control', { paused: [] });

  const refreshAgents = async () => {
    const r = await axios.get('/api/agents');
    setAgents(r.data.agents || []);
  };

  useEffect(() => { refreshAgents(); }, []);

  const isPaused = (name) => ctrl?.paused?.includes(name) || agents.find(a => a.name===name)?.paused;
  const isStopped = (name) => !!stopped[name];

  const setStoppedFor = (name, val) => setStopped(prev => ({ ...prev, [name]: val }));

  const act = async (action, name) => {
    if (action === 'pause') await axios.post('/api/control/pause', null, { params: { agent: name }});
    if (action === 'resume') await axios.post('/api/control/resume', null, { params: { agent: name }});
    if (action === 'stop') {
      await axios.post('/api/control/pause', null, { params: { agent: name }});
      await axios.delete('/api/jobs', { params: { agent: name }});
      setStoppedFor(name, true);
    }
    if (action === 'start') {
      await axios.post('/api/control/resume', null, { params: { agent: name }});
      setStoppedFor(name, false);
    }
    if (action === 'start_early') {
      // Without queue reordering, treat as resume/ensure active
      await axios.post('/api/control/resume', null, { params: { agent: name }});
    }
    await refreshAgents();
  };

  const fmtETA = (s) => {
    if (s == null) return '—';
    const m = Math.floor(s/60), sec = Math.floor(s%60);
    return `${m}m ${sec}s`;
  };

  const Avatar = ({ icon, name }) => {
    if (typeof icon === 'string' && (icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:'))) {
      return <img src={icon} alt={name} className="h-12 w-12 rounded-full object-cover" />
    }
    return (
      <div className="h-12 w-12 rounded-full bg-gray-200 flex items-center justify-center text-2xl">
        {icon || '🤖'}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(() => {
          const dummyAgents = [
            {
              name: 'dummy-rag',
              title: 'Dummy Agent',
              icon: '🧪',
              description: 'Dummy agent. Configure AGENTS env to add real agents.',
              nextTask: { model: 'mistral', priority: 'high', payload: { example: 'Find docs about project' } },
              lane: 'high',
              position: 0,
              eta_seconds: 120,
              paused: false,
              dummy: true,
            },
            {
              name: 'dummy-writer',
              title: 'Dummy Agent',
              icon: '🧑\u200d💻',
              description: 'Dummy agent. Configure AGENTS env to add real agents.',
              nextTask: { model: 'llama3', priority: 'low', payload: { example: 'Draft blog post about AI' } },
              lane: 'low',
              position: 2,
              eta_seconds: 420,
              paused: false,
              dummy: true,
            },
            {
              name: 'dummy-vision',
              title: 'Dummy Agent',
              icon: '👁️',
              description: 'Dummy agent. Configure AGENTS env to add real agents.',
              nextTask: { model: 'vision', priority: 'low', payload: { example: 'Tag images in /photos' } },
              lane: 'low',
              position: 1,
              eta_seconds: 300,
              paused: false,
              dummy: true,
            },
            {
              name: 'dummy-orchestrator',
              title: 'Dummy Agent',
              icon: '🧩',
              description: 'Dummy agent. Configure AGENTS env to add real agents.',
              nextTask: { model: 'small', priority: 'high', payload: { example: 'Coordinate tasks across agents' } },
              lane: 'high',
              position: 0,
              eta_seconds: 60,
              paused: false,
              dummy: true,
            },
          ];
          const displayAgents = agents.length ? agents : dummyAgents;
          return displayAgents.map(a => {
            const stoppedState = isStopped(a.name);
            return (
            <div key={a.name} className={`relative rounded-xl border p-4 transition ${a.dummy ? 'border-dashed bg-gray-50' : 'bg-white'} ${stoppedState ? 'border-red-600 ring-1 ring-red-600' : 'border-gray-200'}`}>
              {/* Gray-out overlay when stopped */}
              {stoppedState && <div className="absolute inset-0 bg-white/50 pointer-events-none rounded-xl"></div>}
              <div className={`space-y-3 ${stoppedState ? 'grayscale' : ''}`}>
                {a.dummy && (
                  <div className="absolute top-2 right-2 text-[10px] uppercase tracking-wide bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Dummy</div>
                )}
                <div className="flex items-center gap-3">
                  <Avatar icon={a.icon} name={a.name} />
                  <div>
                    <div className="font-semibold leading-tight">{a.name}</div>
                    <div className="text-xs text-gray-500">{a.title || a.name}</div>
                    <div className={`text-xs ${isPaused(a.name)?'text-yellow-700':'text-green-700'}`}>{isPaused(a.name) ? 'Paused' : 'Active'}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-700 min-h-[40px]">{a.description || '—'}</div>
                <div className="rounded-lg border bg-gray-50 p-3">
                  <div className="text-xs text-gray-500 mb-1">Next Task</div>
                  {a.nextTask ? (
                    <div className="space-y-1">
                      <div className="text-xs text-gray-500">{a.lane} • position {a.position ?? '—'}</div>
                      <div className="text-sm">model: <span className="font-medium">{a.nextTask.model}</span>, priority: <span className="capitalize">{a.nextTask.priority}</span></div>
                      <pre className="text-xs text-gray-700 max-h-20 overflow-hidden">{JSON.stringify(a.nextTask.payload, null, 0)}</pre>
                    </div>
                  ) : (
                    <div className="text-sm text-gray-500">No queued task</div>
                  )}
                  <div className="text-xs text-gray-600 mt-2">ETA: {fmtETA(a.eta_seconds)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {stoppedState ? (
                    <button disabled={a.dummy} onClick={() => act('start', a.name)} className={`px-3 py-1.5 rounded ${a.dummy? 'bg-gray-300 cursor-not-allowed text-gray-600' : 'bg-green-600 text-white'}`}>Start</button>
                  ) : (
                    <>
                      <button disabled={a.dummy} onClick={() => act('start_early', a.name)} className={`px-3 py-1.5 rounded ${a.dummy? 'bg-gray-300 cursor-not-allowed text-gray-600' : 'bg-blue-700 text-white'}`}>Start Early</button>
                      {isPaused(a.name) ? (
                        <button disabled={a.dummy} onClick={() => act('resume', a.name)} className={`px-3 py-1.5 rounded ${a.dummy? 'bg-gray-300 cursor-not-allowed text-gray-600' : 'bg-green-600 text-white'}`}>Resume</button>
                      ) : (
                        <button disabled={a.dummy} onClick={() => act('pause', a.name)} className={`px-3 py-1.5 rounded ${a.dummy? 'bg-gray-300 cursor-not-allowed text-gray-600' : 'bg-yellow-600 text-white'}`}>Pause Current</button>
                      )}
                      <button disabled={a.dummy} onClick={() => act('stop', a.name)} className={`px-3 py-1.5 rounded ${a.dummy? 'bg-gray-300 cursor-not-allowed text-gray-600' : 'bg-red-600 text-white'}`}>Stop</button>
                    </>
                  )}
                  {a.dummy && (
                    <div className="text-xs text-gray-500">Configure <span className="font-mono bg-gray-100 px-1 rounded">AGENTS</span> to add real agents</div>
                  )}
                </div>
              </div>
            </div>
          );
          });
        })()}
      </div>
    </div>
  );
}

export default function App() {
  const [active, setActive] = useState('overview');
  const stats = useSocketState('stats', null);

  return (
    <div className="min-h-screen bg-gray-100">
      <Header active={active} setActive={setActive} />
      {active === 'overview' && <Overview stats={stats} />}
      {active === 'queue' && <QueueTable stats={stats} />}
      {active === 'agents' && <Agents />}
    </div>
  );
}
