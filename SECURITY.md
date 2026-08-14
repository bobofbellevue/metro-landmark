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

Metro Landmark’s current API identity model is **not safe for an untrusted public internet deployment**.

- Many routes trust client-supplied `x-user-role` / `x-user-id` headers (or have little identity checking at all) while using a privileged database key server-side.
- The browser Supabase client uses a publishable key; row-level security in typical setups is not a full substitute for verified API auth.

**Do not** expose a naive Vercel + Supabase deploy of this project to the open internet and treat it as a production multi-tenant PMS. Use it on trusted networks, for demos under your control, or after implementing auth hardening (see [ROADMAP.md](./ROADMAP.md) item E7).

Never commit live credentials. Use `.db-environments.example.json` and the variables documented in [DEPLOYMENT_SETUP.md](./DEPLOYMENT_SETUP.md).

Compliance features are jurisdiction-pack dependent and may be experimental — they are not a security boundary.
