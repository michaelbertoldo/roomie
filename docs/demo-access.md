# Letting teammates and the professor open the app (no Vercel accounts)

Status today: **nothing is changed**. Vercel Deployment Protection is on its default. Checked on 2026-10-07:
- `https://roomie-mockup.vercel.app` (the project's production URL) answers 200 to anyone. It still serves the old mockup because nothing real has been deployed to production yet.
- Preview URLs, including the stable alias `https://roomie-is401-preview.vercel.app`, answer 302 (Vercel login) unless you are signed in to Vercel as Michael.

Two facts drive every option:
1. **Which database a deployment uses is set by its Vercel environment.** Preview deployments use Neon **dev**. Production deployments use Neon **main** (the demo seed).
2. **Neon Auth only accepts sign-in from trusted origins** of the *same* Neon branch the deployment talks to. A wildcard must be the whole leftmost label (`https://*.example.com`). Never trust `https://*.vercel.app`: that is every app on Vercel.

## Options

### A. Production deploy, protection left alone (recommended)
Merge to `main` (or `vercel deploy --prod`). The production URL is public by default.
- Who can open it: anyone with the link. No Vercel account.
- Database: **main** (demo seed, `MAPLE412`). Keeps dev data and test accounts out of the demo.
- Neon Auth trusted origin needed, on the **main** branch: `https://roomie-mockup.vercel.app` (or the new name if the project is renamed, e.g. `https://roomie.vercel.app`).
- Cost and effort: none. Previews stay private.
- Watch out: a public URL with open sign-up (see Hardening).

### B. Same as A on a custom domain
Buy a domain (about $12 per year), add it to the Vercel project.
- Trusted origin on **main**: `https://app.yourdomain.com` (and the apex or www if used). A wildcard `https://*.yourdomain.com` is allowed because you own it.
- Nicer for a professor ("roomie.yourdomain.com"). Needs DNS setup.

### C. Turn Deployment Protection off for the whole project
Vercel > Project > Settings > Deployment Protection > Vercel Authentication off.
- Every preview and every unique deployment URL becomes public too, and previews use the **dev** database, so strangers could create test data there.
- Trusted origins: still only exact URLs. Previews have a new URL on every push (`roomie-mockup-<hash>-michaels-projects-dd37fd5d.vercel.app`) and each one would need adding. Only the stable alias works in practice: `https://roomie-is401-preview.vercel.app` on **dev** (already trusted).
- Not recommended: it opens the part of the system that is not meant to be public.

### D. Shareable preview links
Vercel can generate a link for one protected preview that works without an account and expires (about a day). I have not tested whether sign-in survives the share cookie through our auth proxy.
- Trusted origin: the exact URL being shared. The alias `https://roomie-is401-preview.vercel.app` is the only stable one (on **dev**).
- Fine for a quick look, poor for a graded demo because links expire.

### E. Protection bypass for automation
A secret header (what `vercel curl` and my tests use). For scripts only: browsers cannot send it.

### F. Password-protect previews
A Vercel Pro feature (paid, per seat). Not available on the Hobby plan.

### G. Fallback that needs nothing
Screen-record the demo, or run it locally (`npm run dev:api` and `npm run dev`; localhost is always trusted by Neon Auth).

## Hardening to do before opening A or B to the world
- Turn on **email verification** in Neon Auth (it is off, so anyone can register any email).
- **Rate-limit** join-code attempts and sign-ups. The demo household code `MAPLE412` is guessable by anyone who sees the screen: rotate it after the demo.
- Decide who may join the demo household. Public sign-up plus a known code means strangers can land in it. `npm run db:unseed:prod && db:seed:prod` resets it.
- Neon Auth currently uses Neon's shared email sender and shared Google OAuth credentials, which are for testing.

## What I would do
A. Merge to `main` when the team is ready, with the origin above added to **main**. Keep previews protected. Do the hardening list first.
