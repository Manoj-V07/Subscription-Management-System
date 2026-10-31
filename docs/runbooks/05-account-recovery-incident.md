# Runbook 05: Account Recovery, Credential Compromise & Session Revocation

## Severity: P1 (Security Incident)
## Audience: Security Operations, Customer Support Leads, System Administrators

---

### 1. Trigger Conditions
- Staff or customer reports suspected unauthorized account access or compromised credentials.
- Security alert: High rate of failed login attempts (`401 INVALID_CREDENTIALS` > 15 within 3 minutes) or anomalous IP origin.
- Urgent executive offboarding request requiring immediate revocation of staff privileges.

---

### 2. Immediate Containment Checklist (Within 10 Minutes)

1. **Locate Target User Record**:
   ```sql
   SELECT id, email, display_name, status, role_id, last_login_at, updated_at
   FROM users
   WHERE email = '<TARGET_EMAIL>';
   ```

2. **Immediately Disable Account & Invalidate Sessions**:
   ```sql
   UPDATE users
   SET status = 'disabled', updated_at = NOW()
   WHERE id = '<USER_ID>';
   ```
   *Note: `authenticate` middleware in `apps/api/src/app.js` checks `user.status === 'active'` on every request. Marking status as `disabled` immediately invalidates all active JWT tokens regardless of expiry.*

3. **Revoke All Active Password Reset Tokens**:
   ```sql
   UPDATE password_reset_tokens
   SET used_at = NOW()
   WHERE user_id = '<USER_ID>' AND used_at IS NULL;
   ```

4. **Log Incident Audit Event**:
   ```sql
   INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, metadata, request_id)
   VALUES (
     '<ADMIN_USER_ID>',
     'security.account_quarantined',
     'user',
     '<USER_ID>',
     '{"reason": "Suspected credential compromise reported by user", "action": "disabled"}'::jsonb,
     'sec_incident_' || EXTRACT(EPOCH FROM NOW())::TEXT
   );
   ```

---

### 3. Investigation & Audit Review

1. **Trace Recent Activity by Compromised User**:
   ```sql
   SELECT action, entity_type, entity_id, metadata, request_id, created_at
   FROM audit_events
   WHERE actor_user_id = '<USER_ID>' AND created_at >= NOW() - INTERVAL '7 days'
   ORDER BY created_at DESC;
   ```
2. **Review High-Risk Changes**:
   - Were any staff members created (`staff.create`)?
   - Were any discounts or tax rules altered (`discount.create`, `discount.update`)?
   - Were any invoice statuses forced or cancelled?
   - Were customer billing emails changed?

---

### 4. Recovery & Re-instatement Protocol

1. **Verify Identity of Requester**:
   Perform out-of-band video or phone verification with the employee or company authorized signatory.
2. **Generate Secure Password Reset**:
   Once identity is verified:
   - Restore account status:
     ```sql
     UPDATE users SET status = 'active', updated_at = NOW() WHERE id = '<USER_ID>';
     ```
   - Trigger secure password reset:
     `POST /api/v1/auth/forgot-password` with user's email.
   - User follows the single-use expiring token link to choose a compliant password (minimum 9 characters, upper, lower, symbol).
3. **Document Incident Postmortem**:
   File an incident log in the security tracking system noting root cause (phishing, weak password, credential stuffing) and preventative measures (e.g. rate limit tightening).

