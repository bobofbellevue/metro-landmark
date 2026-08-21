# Security Policy

## Supported versions

Security fixes are applied on the default branch (`main`).

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email the maintainer privately:

**Robert T. Kelly** — use the email address on the GitHub profile that owns this repository.

Include:

- A short description of the issue and impact
- Steps to reproduce or a non-destructive proof of concept
- Affected paths and environment assumptions (local, Vercel, Supabase)

You should receive an acknowledgment when the report is seen. Coordinated disclosure is preferred; please allow reasonable time for a fix before public discussion.

## Out of scope (examples)

- Issues that require already-compromised admin credentials or physical access
- Vulnerabilities solely in third-party services (Supabase, Vercel, Vapi, SendGrid, and similar) unrelated to this project’s configuration guidance
- Social engineering against operators

## Important: authentication threat model

Metro Landmark is **partially** hardened (roadmap **E7**). It is still **not** safe to treat a naive Vercel + Supabase deploy as a production multi-tenant PMS on the open internet.

**Shipped (E7 first slice)**

- Login issues an HMAC session token. The SPA sends `Authorization: Bearer`, not `x-user-id` / `x-user-role`.
- Listings, payments, payment catalog, phone numbers, org theme, notifications, and audit logs verify that token and load **role from the `users` table**. Spoofed identity headers are ignored.
- CORS on those routes (plus login and brand-config) is origin-allowlisted: localhost, the Vercel deployment URL, and optional `CORS_ORIGIN`.

**Session signing (`SESSION_SECRET`)**

Documented with the other env vars in [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md). If unset, tokens are signed with `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` — a deploy that already has the service role key does **not** need a new variable. Optional later: set `SESSION_SECRET` to a dedicated random string (`openssl rand -hex 32`) so rotating the database key does not invalidate sessions, and so a leaked session secret is not a database admin key.

**Still open**

- Documents, compliance, cron, and other API routes may still trust client headers or have little identity checking, while using a privileged database key server-side.
- The browser Supabase client uses a publishable key. Typical RLS here is permissive (`USING (true)` for anon and authenticated) and is **not** a substitute for verified API auth.

Use the app on trusted networks or for demos under your control until remaining E7 work lands. Never commit live credentials. Use `.db-environments.example.json` and the variables in [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md).

Compliance features are jurisdiction-pack dependent and may be experimental — they are not a security boundary.
