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

## Logic & evaluation (Role 4)
Pure TypeScript in `src/lib/logic/` (import as `@/lib/logic`): hard constraints, option ranking A/B/C, fairness
credits, vote rules (quorum, extension, tie revote, daily "definitely no" limit, split consent), itinerary and the
evaluation tools. Shared Tokyo dataset: `data/spots_tokyo.json` (+ sources and allergens in `data/spots_evidence.json`).
```bash
npm run test:logic              # unit + integration tests
npm run eval:offline            # decision scenarios with fixed votes
npm run eval:ai -- --baseline   # full pipeline on the persona scenarios, no AI (--mock / real model: see docs)
```
How to plug it into the AI module and the API routes: [`docs/logic-integration.md`](docs/logic-integration.md).
Evaluation plan and results: [`docs/evaluation.md`](docs/evaluation.md).
