# Runbook 06: Database Disaster Recovery, Backup Restoration & Integrity Audit

## Severity: P0 (Critical Outage)
## Audience: Infrastructure Engineers, Database Administrators, Engineering Leads

---

### 1. Objectives & SLO Targets
- **Recovery Time Objective (RTO)**: Full service restoration within **30 minutes**.
- **Recovery Point Objective (RPO)**: Maximum acceptable data loss window is **1 hour**.
- **Financial Invariant Guarantee**: Post-restore accounting state MUST satisfy `Total Invoiced = Collected + Owed` with 0 discrepancy.

---

### 2. Backup Architecture & Storage
1. **Automated Backups**: Executed hourly via scheduled cron/pg_dump jobs and persisted to redundant, encrypted object storage.
2. **Cryptographic Checksums**: Every backup archive includes an SHA-256 hash manifest verifying payload immutability and preventing bit rot.
3. **Point-in-Time Recovery (PITR)**: Write-Ahead Logs (WAL) are archived continuously.

---

### 3. Step-by-Step Restoration Procedure

#### Step 1: Declare Incident & Stop Application Write Traffic
To prevent partial writes or split-brain data while restoring:
1. Stop API and background worker instances:
   ```powershell
   # Stop worker and API processes
   Stop-Process -Name node -Force
   ```
2. Notify customer communication team: Post maintenance banner on status page.

#### Step 2: Fetch and Validate Latest Verified Backup
1. Retrieve the latest backup snapshot from storage.
2. Verify archive checksum:
   ```powershell
   Get-FileHash -Algorithm SHA256 <backup_file.json>
   ```
   Compare against metadata hash. If hash does not match, halt and retrieve the preceding verified backup.

#### Step 3: Execute Restoration Engine
Run the automated Brightloop backup-restore tool:
```bash
npm run backup-restore
```
Or execute manual pg_restore:
```bash
psql -U brightloop -d brightloop -f <restore_checkpoint.sql>
```

#### Step 4: Run Post-Restore Integrity & Financial Audit
Verify all core relational tables and foreign key constraints:
1. Table record count sanity check:
   ```sql
   SELECT 
     (SELECT COUNT(*) FROM users) AS users_count,
     (SELECT COUNT(*) FROM customers) AS customers_count,
     (SELECT COUNT(*) FROM subscriptions) AS subscriptions_count,
     (SELECT COUNT(*) FROM invoices) AS invoices_count,
     (SELECT COUNT(*) FROM payments) AS payments_count;
   ```
2. **Reconciliation Audit Query**:
   ```sql
   SELECT 
     SUM(grand_total_cents) AS total_invoiced,
     (SELECT COALESCE(SUM(amount_cents), 0) FROM payments) AS total_collected,
     SUM(balance_due_cents) AS total_owed,
     SUM(grand_total_cents) - ((SELECT COALESCE(SUM(amount_cents), 0) FROM payments) + SUM(balance_due_cents)) AS discrepancy
   FROM invoices 
   WHERE status != 'cancelled';
   ```
   `discrepancy` MUST equal `0`.

#### Step 5: Service Resumption & Smoke Test
1. Start API service:
   `npm start`
2. Run read-only health checks:
   `curl http://localhost:4000/health/readiness`
   Expect status `ready` and database `connected`.
3. Start background worker:
   `npm run worker`
4. Post all-clear update to stakeholders.

