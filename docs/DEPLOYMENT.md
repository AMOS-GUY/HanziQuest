# Deployment

**Status: not deployed yet.** This is the intended path, to be verified in M4.

## Target

- **App:** Vercel (Hobby is enough for the beta) or any Node 20.19+ host running `next start`.
- **Database:** managed PostgreSQL 15+ (for example Neon, Supabase or Vercel Postgres). Needs a
  free or low tier and **automated daily backups with point-in-time recovery**.
- **Monitoring:** Sentry (free tier). `SENTRY_DSN` is reserved but not integrated yet.

Creating these accounts is an owner action. Nothing has been purchased or registered.

## Environment variables

See `.env.example`. Production needs:

| Variable                                   | Notes                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| `DATABASE_URL`                             | Pooled connection string from the provider.                  |
| `AUTH_SECRET`                              | 32+ random bytes, base64. Never reuse the development value. |
| `AUTH_URL`                                 | Public origin, e.g. `https://app.hanziquest.example`.        |
| `AUTH_TRUST_HOST`                          | `true` behind Vercel or another trusted proxy.               |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Only for the first seed. Remove afterwards.                  |

## Release steps

```bash
npm ci
npm run db:deploy        # apply committed migrations (never migrate reset / db push)
npm run db:seed          # idempotent: roles, achievements, starter content, first admin
npm run build
npm start
```

On Vercel, set the build command to `npm run db:deploy && npm run build`. Run the seed once
from a trusted machine.

## Backups and rollback

- Before every migration: take a manual snapshot with the provider's backup feature.
- App rollback: redeploy the previous Vercel deployment.
- Schema rollback: write a forward-fixing migration. Never edit applied migrations.

To be done in M4: a recovery drill (restore a backup into a scratch database and run the smoke
tests against it).
