# SpiceSentry

Run `npm install` and `npm run dev`, then open `http://localhost:5173`. The development server includes the authenticated API and reads existing Firestore data using private server credentials.

See [login recovery and server hosting](docs/login-recovery.md) for credential setup, production requirements, and verification. Production needs `npm run build` followed by `npm start` in a configured Node service; a static `dist/` deployment alone does not provide the API.

Run `npm test` for authentication, authorization, transaction persistence, and retry regressions. The [application audit](docs/application-audit-2026-09-21.md) records the original findings; [storage and recovery](docs/storage-and-recovery.md) explains the submitted-entry fix.

## Frontend tooling

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
