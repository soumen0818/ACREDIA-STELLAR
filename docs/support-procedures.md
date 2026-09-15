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

## 4. Account erasure requests (GDPR Art. 17)

Users can self-serve erasure from **Settings → Delete my account**. Administrator
involvement is only needed if that fails.

What the system does, and what it deliberately retains:

| Data | Outcome |
|---|---|
| Email, name, profile | Deleted / redacted |
| Auth account | Deleted |
| Links to business records | Nulled |
| **Issued credentials** | **Retained** — Art. 17(3)(b) & (d) |
| On-chain hashes | Retained — immutable, no personal data |

Erasing an institution POC does **not** delete that institution's credentials.
Those belong to the graduates who hold them, who are separate data subjects and
did not make the request.

When a POC is erased, the system records an audit row noting whether the
institution was left with no active members — meaning it can no longer issue.
Watch for that flag and re-provision a POC.

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
