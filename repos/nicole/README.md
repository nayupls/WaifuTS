# Nicole

A tiny, mobile-first finance manager for recurring subscriptions.

Enter a subscription — account email, service, payment details, price, and
whether it bills **monthly** (on a day of the month) or **yearly** (on a day +
month) — and Nicole shows you:

- **Cost per month** (yearly plans averaged over 12 months)
- **Cost per year**
- **Cost this month** — charges that actually land this calendar month
- **Cost next month** — charges that land next calendar month

Each subscription card also shows its next charge date. Amounts are stored in
cents, and mixed currencies (EUR/USD/GBP) are summed per currency.

## Stack

- [TanStack Start](https://tanstack.com/start) (React + Vite, SSR)
- [Convex](https://convex.dev) — realtime database & server functions
- [Clerk](https://clerk.com) — authentication

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create a [Clerk](https://dashboard.clerk.com) application, then create a
   **JWT template** named `convex` (Clerk dashboard → JWT templates → New →
   Convex).

3. Create a Convex project and start the backend:

   ```sh
   npx convex dev
   ```

   In the [Convex dashboard](https://dashboard.convex.dev) → Settings →
   Environment variables, set `CLERK_JWT_ISSUER_DOMAIN` to your Clerk Frontend
   API URL (e.g. `https://your-app.clerk.accounts.dev`, shown on the JWT
   template page).

4. Copy `.env.example` to `.env.local` and fill in:

   - `VITE_CONVEX_URL` — printed by `npx convex dev`
   - `VITE_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — Clerk dashboard → API keys

5. Run the app (Convex dev in one terminal, Vite in another — or combined):

   ```sh
   npx convex dev --start 'npm run dev'
   ```

   Open http://localhost:3000 — sign in, add subscriptions, watch the summary
   update live.

## Notes

- `convex/_generated/` is checked in so the app typechecks without a Convex
  deployment; `npx convex dev` regenerates it.
- Billing days past the end of a month clamp to the month's last day
  (a sub billed on the 31st charges Feb 28/29).
- All data is scoped per signed-in user; Convex functions reject
  unauthenticated calls and cross-user deletes.
