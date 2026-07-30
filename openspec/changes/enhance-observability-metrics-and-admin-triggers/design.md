# Design: Enterprise Observability, Structured Logging, Prometheus Metrics, and Task Triggers

## System Architecture

```
 ┌────────────────────────────────────────────────────────────────────────┐
 │                         Observability Layer                            │
 │                                                                        │
 │  ┌──────────────────────────────────────────────────────────────────┐  │
 │  │ 1. Structured JSON Logger (RMABLogger)                           │  │
 │  │    - Emits: timestamp, level, component, correlationId, duration │  │
 │  └──────────────────────────────────┬───────────────────────────────┘  │
 │                                     │                                  │
 │  ┌──────────────────────────────────▼───────────────────────────────┐  │
 │  │ 2. Prometheus Metrics Service                                    │  │
 │  │    - GET /api/metrics                                            │  │
 │  │    - Scrapes: Bull Queue counts, DB Request counts, Cron status  │  │
 │  └──────────────────────────────────┬───────────────────────────────┘  │
 │                                     │                                  │
 │  ┌──────────────────────────────────▼───────────────────────────────┐  │
 │  │ 3. Web Admin Operations & Maintenance Center                     │  │
 │  │    - Trigger Buttons: Backlog Retry, Folder Scan, Scheduler Init │  │
 │  │    - Live Status Cards: Queue Depth, Cron Health                 │  │
 │  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## Component Specifications

### 1. Structured JSON Logger (`src/lib/utils/logger.ts`)
```typescript
export class RMABLogger {
  static create(component: string) {
    return {
      info: (msg: string, meta?: Record<string, any>) =>
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', component, message: msg, ...meta })),
      error: (msg: string, meta?: Record<string, any>) =>
        console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', component, message: msg, ...meta })),
      warn: (msg: string, meta?: Record<string, any>) =>
        console.warn(JSON.stringify({ timestamp: new Date().toISOString(), level: 'WARN', component, message: msg, ...meta })),
    };
  }
}
```

### 2. Prometheus Metrics Route (`src/app/api/metrics/route.ts`)
- Leverages `prom-client` to expose standard counters and gauges:
  ```text
  # HELP rmab_requests_total Total requests by status
  # TYPE rmab_requests_total gauge
  rmab_requests_total{status="available"} 206
  rmab_requests_total{status="downloading"} 0
  
  # HELP rmab_bull_queue_jobs Total jobs in Bull queue by status
  # TYPE rmab_bull_queue_jobs gauge
  rmab_bull_queue_jobs{status="active"} 12
  rmab_bull_queue_jobs{status="waiting"} 5
  ```

### 3. Operations UI Component (`src/components/admin/operations-center.tsx`)
- Renders maintenance action cards with one-click trigger buttons:
  - `[ 🔄 Trigger Backlog Retry ]`
  - `[ 📁 Scan Completed Downloads ]`
  - `[ 🏥 Run System Health Audit ]`
  - `[ ⚡ Restart Scheduler Daemon ]`

## Test & Validation Plan
1. **JSON Logger Unit Test:** Verify logger output parses as valid JSON with required schema fields (`timestamp`, `level`, `component`).
2. **Metrics Endpoint Test:** Fetch `GET /api/metrics` and verify Prometheus syntax validation rules.
3. **UI Trigger Test:** Click "Scan Completed Downloads" button in Admin UI and verify HTTP `200 OK` response with job ID.
