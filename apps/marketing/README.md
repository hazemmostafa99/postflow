# PostFlow Marketing

Public marketing site for `ipostflow.com`.

## Local development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000` and links to the Sales application using `NEXT_PUBLIC_SALES_APP_URL`.

Copy `.env.example` to `.env.local` for local development.

For production, Next.js automatically loads `.env.production` during `npm run build` and `npm run start`. The production values are documented in `.env.production.example`; configure the same values in the hosting provider when deploying.
