# wayway
AI travel planning app

## Run the web app
Requires Node.js 20+.
```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev                  # http://localhost:3000
```
Stack: Next.js 16 (App Router, TypeScript, Tailwind) + Supabase. Shared types live in `src/contracts/contract.ts` (import as `@/contracts/contract`).
