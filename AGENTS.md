# MiChofer AI Agent Guide

## Project overview
- Frontend-first React application built with Vite.
- Uses Supabase for auth, profile storage, avatars, and custom database functions.
- Includes a demo ride-booking experience with Login, Client, Driver, Admin, Chat, and Trips pages.
- No backend server code in this repository beyond the Supabase SQL schema and RPC scripts under `supabase/`.

## Run and build
- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

## Important environment details
- The app reads Supabase values from `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_ANON_KEY`.
- The repo includes `.env.example`; actual credentials should be placed in `.env`.
- Without `.env`, the app still runs in a visual demo mode but real login and Supabase flows are disabled.

## Key files and folders
- `src/App.jsx` — main landing page shell.
- `src/main.jsx` — app bootstrap.
- `src/pages/` — route-level page components.
- `src/components/` — reusable UI components, including `InteractiveRouteMap.jsx`.
- `src/lib/supabase.js` — Supabase client creation and helper RPC wrappers.
- `vite.config.js` — Vite config enabling a `/supabase-proxy` proxy if Supabase URL is provided.
- `supabase/schema.sql` and related `.sql` files — database schema, policies, and RPC definitions.

## Development guidance for agents
- Preserve the Vite/React structure and avoid introducing server-side frameworks.
- Prefer using existing `src/lib/*` helpers for Supabase and place new shared logic there when appropriate.
- Keep UI changes consistent with current Spanish/Paraguayan UX text and layout style.
- Use the existing page/component organization: add features in `src/pages` and `src/components` before adding broad global structure.

## Notes for debugging
- Many login/profile flows depend on Supabase row-level security and storage policies defined in `supabase/`.
- The app expects some data in `supabase/` SQL scripts; if auth errors occur, inspect the schema and RPC SQL files.
- The project is mainly client-rendered; network and auth logic is in the browser.

## References
- `README.md` — local startup and Supabase setup instructions.
- `package.json` — dependencies and scripts.
