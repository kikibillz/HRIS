# PeopleOS HRIS

A local development HR workspace built with Next.js, React, TypeScript, and SQLite. Includes a live dashboard, searchable employee directory, employee creation, department creation, leave submission, and approval/decline workflows. The responsive interface uses illustrative sample people; no real employee records are included.

## Development

Requires Node.js 24 (uses built-in `node:sqlite`) and npm 11.

```sh
npm ci
npm run dev
```

The app listens on port 3000. SQLite is created and seeded automatically at `data/hris.sqlite`; the directory is ignored by Git. Set `HRIS_DATA_DIR` to change storage location. No external services or credentials are required. Preserve the database to retain records; remove it only when you intentionally want to reset sample data.

```sh
npm run typecheck
npm run build
npm test
npm start
```

## Scope

This is a functional development MVP, without authentication or role permissions. All app users can view employee details and decide leave requests. Use only sample data until authentication, authorization, audit logging, privacy controls, and deployment security have been implemented. Payroll, attendance, recruiting, and integrations are future work. The UI marks its sample dataset explicitly.

API endpoints: POST `/api/employees`, POST `/api/departments`, POST `/api/leaves`, PATCH `/api/leaves`. SQLite constraints and server-side validation protect references, duplicate emails, and leave decisions.

`npm test` starts a production server on port 3101 with a temporary database, tests rendering and API workflows, and removes its test data afterward. Run a build first.

The code and required tools are free and open source. There are no paid API dependencies or subscriptions. Public hosting and domain costs depend on the provider you choose.
