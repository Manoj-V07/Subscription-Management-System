# Runbook 04: Background Worker Backlog & Queue Stalls

## Severity: P2 (Medium) to P1 (if billing run delayed > 2 hours)
## Audience: On-Call DevOps/SRE, Backend Engineers

---

### 1. Symptoms & Alert Triggers
- Alert: `WorkerQueueBacklogHigh` (Number of pending billing occurrences > 500 or oldest pending occurrence age > 30 minutes).
- Worker process crash loops or high CPU / memory utilization.
- Customers report overdue notices not being generated on scheduled billing dates.

---

### 2. Diagnostic Steps

1. **Check Worker Process Health**:
   ```powershell
   Get-Process -Name node | Select-Object Id, CPU, WorkingSet64, StartTime
   ```
   Or on container environments:
   ```bash
   docker compose ps worker
   docker compose logs --tail=100 worker
   ```

2. **Inspect Occurrence Queue Depth & Age**:
   ```sql
   SELECT 
     status, 
     COUNT(*) AS count,
     MIN(created_at) AS oldest_pending,
     MAX(created_at) AS newest_pending
   FROM billing_occurrences
   GROUP BY status;
   ```

3. **Identify "Poison" Jobs (High Retry Count or Crashed Records)**:
   ```sql
   SELECT id, subscription_id, retry_count, last_error, updated_at
   FROM billing_occurrences
   WHERE status = 'pending' AND retry_count >= 3
   ORDER BY retry_count DESC
   LIMIT 20;
   ```

---

### 3. Remediation Actions

#### Step 1: Mitigate Poison Pills
If a specific corrupted subscription record repeatedly causes worker unhandled rejections:
1. Isolate the offending occurrence by setting status to `failed`:
   ```sql
   UPDATE billing_occurrences
   SET status = 'failed', last_error = 'Quarantined by on-call SRE due to unhandled exception.'
   WHERE id = '<POISON_OCCURRENCE_ID>';
   ```
2. The worker queue will immediately resume processing subsequent subscriptions.

#### Step 2: Scale Worker Instances
The billing engine uses row-level atomic locking (`FOR UPDATE SKIP LOCKED` or idempotency constraint):
- Increase worker replica count from 1 to 3 to drain the backlog:
  ```powershell
  # Start supplementary background worker process
  npm run worker
  ```
- Because of unique idempotency keys (`sub_<id>_<start>_<end>`), multiple workers can process occurrences concurrently without creating duplicate invoices.

#### Step 3: Pause Scheduler During Deep Outage
If the underlying PostgreSQL cluster is undergoing maintenance:
1. Stop the worker process cleanly (`SIGTERM`).
2. Schedulers will not generate partial runs.
3. Once DB maintenance is finished, start the worker:
   `npm run worker`
   The worker will automatically detect past-due subscriptions and process them systematically.

