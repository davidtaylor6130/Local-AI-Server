# Queue Protocol (HTTP, JSON)

Endpoints (internal-only for now)
- POST /enqueue
  - body: { id?, agent, model, priority: "high"|"low", payload: object }
  - returns: { id }

- GET /dequeue?agent=<name>
  - returns: { id, agent, model, priority, payload } or 204 No Content

- POST /complete/{id}
  - body: { status: "ok"|"error", result?: object, error?: string }
  - returns: 200 OK

Monitoring & control (added for dashboard)
- GET /stats
  - returns: {
      queues: { high: Job[], low: Job[] },
      inflight: Job[],
      metrics: { queued_high: number, queued_low: number, inflight: number, by_agent: { [name]: { queued_high, queued_low, inflight } } }
    }

- GET /peek?agent=<name>
  - returns: { job, lane: "high"|"low", position } or 204 No Content

- POST /control/pause?agent=<name>
  - pauses delivery to that agent (dequeue returns 204)

- POST /control/resume?agent=<name>
  - resumes delivery

- GET /control/state
  - returns: { paused: string[] }

- DELETE /jobs?agent=<name>
  - removes all queued (non-inflight) jobs for the agent

- POST /control/skip_next?agent=<name>
  - moves the agent's next queued job to the back of its lane

- POST /control/bring_forward?agent=<name>
  - moves the agent's next job to the front of "high" lane (promote if needed)

- POST /control/stop?agent=<name>
  - pauses the agent and purges its queued jobs (inflight cannot be cancelled by queue)

Notes
- High-priority tasks are always delivered before low when available.
- Agents are expected to long-poll or backoff when 204 is returned.
- Future extension: visibility timeouts, retries, dead-letter.
