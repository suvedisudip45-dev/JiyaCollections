# Marketing Partner Portal

A Vite + React marketing portal for authenticated marketing partners, integrated with the existing backend marketing-card APIs.

## Tech stack

- React 18
- Vite
- Tailwind CSS
- React Router
- Axios
- Lucide icons

## Scripts

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Environment

Create a `.env` file in this folder with the backend origin used by the app:

```env
VITE_BACKEND_URL=http://localhost:4000
```

## Notes

This portal follows the repository’s existing pattern of JWT-based auth and route-level protection. It is intentionally scoped to the backend’s marketing partner endpoints rather than introducing a duplicate auth system.
