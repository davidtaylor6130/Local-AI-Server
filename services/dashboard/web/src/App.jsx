/*
  Overhauled AI Agent Dashboard
  -------------------------------------------------------------
  • Tech: React + TailwindCSS + socket.io-client + axios
  • UI Kit: shadcn/ui + lucide-react (icons) + recharts (mini charts)
  • Drop-in replacement for your current single-file App
  • Keeps your existing API and socket events: 'stats' and 'control'
  • Endpoints used: /api/agents, /api/control/(pause|resume), DELETE /api/jobs?agent=NAME

  Notes
  -----
  - If you don't have shadcn/ui set up, swap the imported UI primitives for your own
    or follow https://ui.shadcn.com docs to generate components under '@/components/ui'.
  - All functionality is preserved; design adds: dark mode, filters, charts, dialogs,
    skeletons, badges, better affordances, and keyboard-focusable controls.
*/

import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

// shadcn/ui primitives (assumes they exist under this path)
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

// Icons
import {
  Bolt, Activity, CirclePause, CirclePlay, Square, RotateCcw,
  Wifi, WifiOff, Rocket, Timer, Gauge, Layers, Search, Filter,
  ListChecks, Cpu, ChevronRight, AlertTriangle, CheckCircle, X, Clipboard
} from 'lucide-react';

// Charts
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, Legend } from 'recharts';

// Socket
const socket = io();

// --------------------------- utils ----------------------------
function useSocketState(eventName, initial) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    const handler = (data) => setState(data);
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
  }, [eventName]);
  return state;
}

const cls = (...xs) => xs.filter(Boolean).join(' ');

function fmtETA(s) {
  if (s == null) return '—';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}m ${sec}s`;
}

function shortId(id) { return id ? (id.length > 10 ? id.slice(0,10) + '…' : id) : '—'; }

function PriorityBadge({ p }) {
  if (!p) return <Badge variant="secondary">—</Badge>;
  const variant = p === 'high' ? 'destructive' : 'secondary';
  return <Badge variant={variant} className="capitalize">{p}</Badge>;
}

function StatusDot({ online }) {
  return (
      <span className={cls(
          'inline-flex h-2.5 w-2.5 rounded-full',
          online ? 'bg-emerald-500' : 'bg-gray-400'
      )} />
  );
}

function JSONBlock({ value, maxHeight = '16rem' }) {
  return (
      <pre className="text-xs bg-muted rounded-md p-3 overflow-auto" style={{ maxHeight }}>
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

// --------------------------- header ----------------------------
function TopBar({ connected, dark, setDark, lastUpdated }) {
  return (
      <div className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <Rocket className="h-5 w-5" />
          <div className="font-semibold tracking-tight">Local AI Dashboard</div>
          <Badge variant="outline" className="ml-1">v2</Badge>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="flex items-center gap-2">
              <StatusDot online={connected} />
              <span className="text-muted-foreground hidden sm:inline">{connected ? 'Live' : 'Offline'}</span>
            </div>
            <Separator orientation="vertical" className="h-5" />
            <div className="hidden md:flex items-center gap-2 text-muted-foreground">
              <Timer className="h-4 w-4" />
              <span className="whitespace-nowrap">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '—'}</span>
            </div>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <Wifi className={cls('h-4 w-4', connected ? '' : 'hidden')} />
              <WifiOff className={cls('h-4 w-4', connected ? 'hidden' : '')} />
              <span className="text-muted-foreground">Socket</span>
            </div>
            <Separator orientation="vertical" className="h-5" />
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Dark</span>
              <Switch checked={dark} onCheckedChange={setDark} />
            </div>
          </div>
        </div>
      </div>
  );
}

// --------------------------- overview ----------------------------
function StatCard({ title, value, icon: Icon, tone='default', subtitle }) {
  return (
      <Card className={cls(tone==='danger' && 'border-destructive/40')}>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-3xl font-semibold leading-tight">{value ?? 0}</div>
          {subtitle && <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>}
        </CardContent>
      </Card>
  )
}

function Overview({ stats }) {
  const m = stats?.metrics || { queued_high: 0, queued_low: 0, inflight: 0, by_agent: {} };
  const agents = Object.entries(m.by_agent || {}).map(([name, v]) => ({ name, ...v }));

  const pieData = useMemo(() => ([
    { name: 'High', value: m.queued_high || 0 },
    { name: 'Low', value: m.queued_low || 0 },
    { name: 'In-Flight', value: m.inflight || 0 },
  ]), [m]);

  const barData = useMemo(() => (
      agents.map(a => ({ name: a.name, High: a.queued_high || 0, Low: a.queued_low || 0, InFlight: a.inflight || 0 }))
  ), [agents]);

  const totalQueued = (m.queued_high || 0) + (m.queued_low || 0);
  const highPct = totalQueued ? Math.round(((m.queued_high || 0) / totalQueued) * 100) : 0;

  return (
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Queued (High)" value={m.queued_high} icon={Bolt} tone={m.queued_high>0? 'danger':'default'} />
          <StatCard title="Queued (Low)" value={m.queued_low} icon={Layers} />
          <StatCard title="In-Flight" value={m.inflight} icon={Activity} />
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">High vs Low</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-3">
                <Progress value={highPct} className="h-2" />
                <div className="text-xs text-muted-foreground w-20 text-right">{highPct}% high</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Workload Mix</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={80} paddingAngle={2}>
                    <Cell fill="#16a34a" />
                    <Cell fill="#94a3b8" />
                    <Cell fill="#0ea5e9" />
                  </Pie>
                  <Legend />
                  <RTooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">By Agent</CardTitle>
            </CardHeader>
            <CardContent>
              {agents.length === 0 ? (
                  <div className="text-muted-foreground">No agents yet</div>
              ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData}>
                        <XAxis dataKey="name" hide={false} />
                        <YAxis allowDecimals={false} />
                        <Legend />
                        <RTooltip />
                        <Bar dataKey="High" stackId="a" />
                        <Bar dataKey="Low" stackId="a" />
                        <Bar dataKey="InFlight" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
  );
}

// --------------------------- queue ----------------------------
function QueuePanel({ stats }) {
  const high = stats?.queues?.high || [];
  const low = stats?.queues?.low || [];
  const rows = useMemo(() => ([
    ...high.map(j => ({ ...j, lane: 'high' })),
    ...low .map(j => ({ ...j, lane: 'low'  }))
  ]), [high, low]);

  const agents = useMemo(() => Array.from(new Set(rows.map(r => r.agent).filter(Boolean))).sort(), [rows]);
  const [q, setQ] = useState('');
  const [agent, setAgent] = useState('all');
  const [priority, setPriority] = useState('all');
  const [selected, setSelected] = useState(null);

  const filtered = rows.filter(r => {
    const matchesText = q ? (r.id?.includes(q) || r.agent?.toLowerCase().includes(q.toLowerCase()) || JSON.stringify(r.payload).toLowerCase().includes(q.toLowerCase())) : true;
    const matchesAgent = agent === 'all' ? true : r.agent === agent;
    const matchesPriority = priority === 'all' ? true : (r.priority === priority);
    return matchesText && matchesAgent && matchesPriority;
  });

  return (
      <div className="max-w-7xl mx-auto p-4 space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Queued Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-center mb-3">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search id / agent / payload" className="pl-8 w-64" />
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={agent} onValueChange={setAgent}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Agent" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All agents</SelectItem>
                    {agents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All priorities</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto text-sm text-muted-foreground">{filtered.length} shown • {rows.length} total</div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="w-[60%]">Payload</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-10">Queue is empty</TableCell>
                      </TableRow>
                  ) : (
                      filtered.map(j => (
                          <TableRow key={j.id} className="hover:bg-muted/40">
                            <TableCell className="font-mono text-xs">{shortId(j.id)}</TableCell>
                            <TableCell>{j.agent || '—'}</TableCell>
                            <TableCell>{j.model || '—'}</TableCell>
                            <TableCell><PriorityBadge p={j.priority} /></TableCell>
                            <TableCell>
                              <div className="max-h-20 overflow-hidden rounded border bg-muted/40 p-2">
                                <code className="text-xs text-muted-foreground">{JSON.stringify(j.payload)}</code>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="outline" size="icon" onClick={()=>setSelected(j)}>
                                        <Gauge className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Details</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={()=>navigator.clipboard?.writeText(j.id)}>
                                        <Clipboard className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Copy ID</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                {/* Per-job cancel not implemented server-side; leaving disabled */}
                                <Button variant="destructive" size="sm" disabled title="Cancel not available in API">Cancel</Button>
                              </div>
                            </TableCell>
                          </TableRow>
                      ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Job Details</DialogTitle>
              <DialogDescription className="space-y-1 text-xs">
                <div><span className="text-muted-foreground">ID:</span> <code className="font-mono">{selected?.id}</code></div>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="secondary">Agent: {selected?.agent || '—'}</Badge>
                  <Badge variant="secondary">Model: {selected?.model || '—'}</Badge>
                  <Badge variant="secondary">Lane: {selected?.lane || '—'}</Badge>
                  <PriorityBadge p={selected?.priority} />
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <div className="text-sm font-medium mb-1">Payload</div>
                <JSONBlock value={selected?.payload} maxHeight="24rem" />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
  );
}

// --------------------------- agents ----------------------------
function AgentsPanel() {
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
      await axios.post('/api/control/resume', null, { params: { agent: name }});
    }
    await refreshAgents();
  };

  const Avatar = ({ icon, name }) => {
    if (typeof icon === 'string' && (icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:'))) {
      return <img src={icon} alt={name} className="h-12 w-12 rounded-full object-cover" />
    }
    return (
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center text-2xl">
          {icon || '🤖'}
        </div>
    );
  };

  // Dummy placeholders if no agents detected
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

  return (
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayAgents.map(a => {
            const stoppedState = isStopped(a.name);
            const paused = isPaused(a.name);
            return (
                <Card key={a.name} className={cls('relative transition', a.dummy ? 'border-dashed bg-muted/40' : '', stoppedState ? 'border-destructive ring-1 ring-destructive' : '')}>
                  {stoppedState && <div className="absolute inset-0 bg-background/60 pointer-events-none rounded-xl" />}
                  {a.dummy && (
                      <div className="absolute top-2 right-2 text-[10px] uppercase tracking-wide bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Dummy</div>
                  )}
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-3">
                      <Avatar icon={a.icon} name={a.name} />
                      <div>
                        <div className="font-semibold leading-tight flex items-center gap-2">
                          {a.name}
                          {paused ? (
                              <Badge variant="secondary" className="gap-1"><CirclePause className="h-3 w-3" /> Paused</Badge>
                          ) : (
                              <Badge className="bg-emerald-600 hover:bg-emerald-600 gap-1"><CirclePlay className="h-3 w-3" /> Active</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{a.title || a.name}</div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className={cls('space-y-3', stoppedState ? 'grayscale' : '')}>
                    <div className="text-sm text-muted-foreground min-h-[40px]">{a.description || '—'}</div>
                    <div className="rounded-lg border bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground mb-1">Next Task</div>
                      {a.nextTask ? (
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">{a.lane || '—'} • position {a.position ?? '—'}</div>
                            <div className="text-sm">model: <span className="font-medium">{a.nextTask.model}</span>, priority: <span className="capitalize">{a.nextTask.priority}</span></div>
                            <JSONBlock value={JSON.stringify(a.nextTask.payload)} />
                          </div>
                      ) : (
                          <div className="text-sm text-muted-foreground">No queued task</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                        <Timer className="h-3.5 w-3.5" /> ETA: {fmtETA(a.eta_seconds)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {stoppedState ? (
                          <Button disabled={a.dummy} onClick={() => act('start', a.name)} variant="default">Start</Button>
                      ) : (
                          <>
                            <Button disabled={a.dummy} onClick={() => act('start_early', a.name)} variant="secondary" className="gap-1"><Rocket className="h-4 w-4" /> Start Early</Button>
                            {paused ? (
                                <Button disabled={a.dummy} onClick={() => act('resume', a.name)} className="gap-1"><CirclePlay className="h-4 w-4" /> Resume</Button>
                            ) : (
                                <Button disabled={a.dummy} onClick={() => act('pause', a.name)} variant="outline" className="gap-1"><CirclePause className="h-4 w-4" /> Pause</Button>
                            )}
                            <Button disabled={a.dummy} onClick={() => act('stop', a.name)} variant="destructive" className="gap-1"><Square className="h-4 w-4" /> Stop</Button>
                          </>
                      )}
                      {a.dummy && (
                          <div className="text-xs text-muted-foreground">Configure <span className="font-mono bg-muted px-1 rounded">AGENTS</span> to add real agents</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
            );
          })}
        </div>
      </div>
  );
}

// --------------------------- main app ----------------------------
export default function App() {
  const [active, setActive] = useState('overview');
  const stats = useSocketState('stats', null);
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('dark'); else root.classList.remove('dark');
  }, [dark]);

  return (
      <TooltipProvider>
        <div className="min-h-screen bg-background text-foreground">
          <TopBar connected={connected} dark={dark} setDark={setDark} lastUpdated={stats?.ts || null} />
          <div className="max-w-7xl mx-auto p-4">
            <Tabs value={active} onValueChange={setActive}>
              <div className="flex items-center justify-between mb-3">
                <TabsList>
                  <TabsTrigger value="overview" className="gap-1"><Activity className="h-4 w-4" /> Overview</TabsTrigger>
                  <TabsTrigger value="queue" className="gap-1"><ListChecks className="h-4 w-4" /> Queue</TabsTrigger>
                  <TabsTrigger value="agents" className="gap-1"><Cpu className="h-4 w-4" /> Agents</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={()=>window.location.reload()} className="gap-1">
                    <RotateCcw className="h-4 w-4" /> Refresh
                  </Button>
                </div>
              </div>

              <TabsContent value="overview">
                <Overview stats={stats} />
              </TabsContent>

              <TabsContent value="queue">
                <QueuePanel stats={stats} />
              </TabsContent>

              <TabsContent value="agents">
                <AgentsPanel />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </TooltipProvider>
  );
}
