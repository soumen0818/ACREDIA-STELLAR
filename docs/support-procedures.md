# Support Procedures

Operational runbooks for Acredia administrators. These describe actions that
change who can access an institution, so each one is effectively an account
takeover performed on purpose — they must be consistent, verifiable, and logged.

**Audience:** Acredia administrators (people on the `ADMIN_EMAIL_ALLOWLIST`).

---

## 1. Point of contact (POC) handover

Used when an institution's contact leaves, changes role, or is permanently
locked out.

### 1.1 Why this needs a procedure

Replacing an institution's POC hands a new person the ability to issue
credentials in that institution's name. An attacker who can social-engineer this
request does not need to break any cryptography — they simply ask to become the
issuer.

Identity verification is therefore the actual security control here. The
software cannot perform it.

### 1.2 Verification requirements

Before actioning **any** handover, confirm all of the following:

1. **The request arrives through a channel tied to the institution** — the
   contact form, or an email address on the institution's own domain. A request
   from a personal mailbox is not sufficient on its own.
2. **The requester is verifiably senior to the outgoing POC**, or is the
   outgoing POC. Acceptable evidence: a message from a role address
   (`registrar@`, `admin@`) on the institution's domain, or confirmation on
   institution letterhead.
3. **Independent confirmation on a second channel.** Call a phone number listed
   on the institution's *public website* — never a number supplied in the
   request itself.
4. **The new POC email is on the institution's domain.** If it is not, record
   the reason explicitly.

If any of the four cannot be satisfied, **do not proceed.** Escalate instead.

### 1.3 Actioning the handover

1. Open **Admin console → Institutions → [institution] → POC handover**.
2. Enter the new POC's name and email.
3. Record, in the reason field: who requested it, on what date, through which
   channel, and how identity was verified.
4. Submit. The system will:
   - Deactivate the outgoing POC's access (**it does not delete the account** —
     the audit trail must survive)
   - Provision the new POC
   - Generate a single-use, expiring invite link
   - Write an `admin_audit_logs` row recording actor, target, and reason
5. Deliver the invite link to the new POC. Email is attempted automatically;
   the link is also shown in the console for manual delivery if mail is
   delayed or filtered.

### 1.4 What is deliberately *not* affected

- **Credentials already issued remain valid and verifiable.** Changing who
  administers an institution never revokes what it has issued.
- **On-chain issuer authorization is unchanged.** If the institution's wallet
  must also change, that is a separate on-chain action requiring the contract
  owner — see §3.

---

## 2. Password reset when email does not arrive

Acredia accounts are provisioned, never self-registered, so a user who cannot
receive mail has no other route in.

1. Ask the user to check spam and confirm the address on file is correct.
2. If mail still does not arrive, open **Admin console → Institutions →
   [institution]** and generate a **recovery link**.
3. The link is single-use and expires in 24 hours. Regenerating invalidates any
   previous link.
4. Deliver it through a channel you have already verified belongs to that
   person.
5. The generation is audit-logged automatically.

> **Never** send a recovery link to an address supplied in the request itself
> without verifying it matches the account on file.

**If resets fail repeatedly across many users**, the cause is usually the mail
sender, not the accounts. Confirm custom SMTP is configured — Supabase's
built-in sender is heavily rate-limited and is not suitable for production.

---

## 3. Changing an institution's issuing wallet

The most privileged operation in the product.

1. Verify identity to the same standard as §1.2, **plus** confirmation from the
   outgoing wallet holder where possible.
2. Confirm the new wallet address through a second channel. Wallet addresses are
   a prime target for substitution — a single altered character sends issuing
   rights to an attacker.
3. Revoke the old issuer authorization on-chain.
4. Authorize the new wallet via **Admin console → Authorize issuer**, signed by
   the contract owner wallet.
5. Record both transaction hashes in the institution's notes.

Credentials issued by the previous wallet **remain valid** — they were validly
issued at the time. Do not revoke them as part of a wallet change.

---

## 4. Account erasure requests (GDPR Art. 17 / DPDP Act)

Account deletion is **account-only** (decided 2026-10-29, review §3.10):

| Data | Outcome |
|---|---|
| Login, email, profile, notification preferences | Deleted |
| Link between the account and the student roster record | Removed |
| Student roster record | **Retained** — the institution's record |
| **Issued credentials** | **Retained and still verifiable** |
| Institution memberships | **Retained** as history, unlinked and deactivated |
| On-chain records | Retained — immutable |
| The erasure request itself | Retained 7 years, as evidence it was completed |

If someone asks for their **student record or credential data** to be corrected
or removed, that is the institution's decision as the data controller for those
records: forward the request to the institution's point of contact.

### 4.1 Students: self-service

Students delete their own account from **Settings → Delete my account**.
Support is only needed if that fails: the request is then left in
`erasure_requests` with `status = 'failed'` and a `failure_reason`. To retry it,
in the Supabase SQL editor:

```sql
SELECT id, auth_user_id, failure_reason, requested_at
FROM public.erasure_requests
WHERE status = 'failed'
ORDER BY requested_at DESC;

UPDATE public.erasure_requests SET status = 'processing', failure_reason = NULL
WHERE id = '<request id>';

SELECT public.process_erasure('<request id>');
```

Then delete the login (step 4 of §4.2).

### 4.2 Institution staff and administrators: through support

The app refuses their self-deletion and shows **Request account removal**,
which emails us. Removing them carelessly can leave an institution unable to
issue or revoke, so:

1. **Verify the request** comes from the account's own email address. Treat it
   with the same care as §1.2: it removes someone's access to an institution.
2. **Keep the institution working before anything is deleted.**
   - If they are the institution's point of contact, run the POC handover (§1)
     first.
   - Otherwise, an owner of the institution removes them on the **Team** page.
   - Check the institution in the admin console still has someone able to
     issue. If it will not, tell the institution and get their agreement
     before continuing.
   - For an Acredia administrator, also remove their email from
     `ADMIN_EMAIL_ALLOWLIST` in the hosting environment and redeploy.
3. **Erase the account data** in the Supabase SQL editor:

   ```sql
   -- Record the request (kept 7 years). Note the returned id.
   INSERT INTO public.erasure_requests (auth_user_id, status)
   VALUES ('<account id>', 'processing')
   RETURNING id;

   -- Delete the profile and unlink the account from the roster.
   SELECT public.process_erasure('<request id>');
   ```

4. **Delete the login**: Supabase dashboard → Authentication → Users → the
   user → Delete user. Their institution memberships are kept automatically,
   unlinked and marked deactivated, as the record of who held which role.
5. **Reply** to confirm the removal is complete.

---

## 5. Escalation

Stop and escalate rather than improvise if:

- Identity verification under §1.2 cannot be completed
- The request is unusually urgent, or pressures you to skip a step
- The same institution requests repeated handovers in a short period
- A wallet change is requested together with a POC change
- Anything suggests a compromised mailbox

Social-engineering attempts against credential issuers look exactly like
legitimate urgent requests. Slowing down costs a day; getting it wrong puts
forged credentials on a public ledger under a real institution's name.
