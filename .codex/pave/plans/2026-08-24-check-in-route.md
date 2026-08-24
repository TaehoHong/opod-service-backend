# Check-in API and screen

## Outcome

Authenticated users can see today's attendance state from Profile, open a full
attendance screen that automatically submits the daily check-in, browse monthly
attendance history and reward milestones, see the granted reward, and receive a
stable completed state after reload. The old
`POST /credits/check-in` route is removed.

## Evidence and design-system source

- `user-confirmed`: the public API route is `/check-in`, not
  `/credits/check-in`, and the attendance screen must match the existing design
  system.
- `repo-evidenced`: `CreditsService.checkIn` owns the authenticated KST daily
  check-in, reward, milestone, and duplicate protection behavior
  (`owner-found`).
- `repo-evidenced`: the UI is owned by `opod-web`; `opod-app` is a single
  WebView wrapper and needs no feature code.
- Design-system source: `opod-web/src/app/globals.css` tokens and
  `docs/shadcn-kibo-restyle-guide.md`; canonical page chrome is
  `MainLayout`, canonical action is `components/ui/button.tsx`, and the
  originating menu is `domains/profile/SettingsList.tsx`.
- No design-system deviation, new token, component variant, schema change, or
  DDL is required.

## Scope map

### In scope

- Backend query contract:
  `GET /check-in?month=YYYY-MM` for today's state, selected-month dates/count,
  daily reward, and 7/14/30 milestone progress.
- Backend mutation contract: `POST /check-in`.
- Web route: `/profile/check-in`, protected by the existing `/profile` auth
  prefix.
- Profile `시작하기` / `완료` state, selected-month navigation, attendance
  calendar, milestone progress, and initial/loading/auto-submitting/success/
  already-completed/retryable-error UI states.
- Existing MSW development flow and API-client contract documentation.
- Profile credit balance refresh when returning from a successful check-in.

### Preserve current behavior

- Check-in response fields: `checkInDate`, `creditsGranted`, `milestoneBonus`,
  `monthCheckInCount`.
- `409 Already checked in today`, KST date rules, reward pricing, auth, and all
  other `/credits/*` routes.
- Existing dark theme, spacing, typography, focus treatment, responsive app
  column, bottom navigation, and ssgoi route behavior.

### Deferred / out of scope

- A separate `GET /check-in/history` endpoint; the `month` query on
  `GET /check-in` owns monthly history.
- Streaks, missed-day recovery, retroactive check-in, future-month attendance,
  reminder notifications, and reward claiming separate from check-in.
- A compatibility alias for `POST /credits/check-in`.
- Native Expo screen or bridge changes.
- New database columns or migrations.

## Feature inventory

- Actor/permission: authenticated user; `/profile/check-in` inherits the
  existing route guard and API client Bearer/refresh behavior.
- Trigger: Profile loads today's state and the user selects `출석체크`.
- Happy path: the attendance screen loads the current KST month and, when today
  is not complete, immediately calls `POST /check-in`; it then refetches status,
  shows checked dates and milestone progress, and announces the granted reward.
- Month history: navigate through current and past months; future-month
  navigation is disabled. Calendar dates and milestone values come from the
  server response.
- Duplicate edge: initial GET normally prevents a duplicate request; a race or
  stale client that receives HTTP 409 refetches status and resolves to
  `오늘 출석을 이미 완료했어요.` rather than showing an error.
- Failure edge: initial-load failure shows an inline retry state; month-history
  failure preserves the current calendar and exposes an inline retry action.
- Concurrency: deduplicate the screen entry effect and treat server HTTP 409 as
  an already-complete result; server uniqueness remains the final guard.
- Data rule: the server owns KST today, daily reward, milestone thresholds and
  bonuses, checked dates, and count. The production UI does not duplicate
  reward or timezone policy.
- Accessibility: semantic button, disabled/loading state, visible focus,
  `aria-live` result messaging, decorative icon hidden from assistive tech.
- Acceptance: the old path is absent; GET returns current/past-month state;
  POST succeeds once and updates GET; duplicate calls complete safely; Profile
  shows `완료`; the calendar and milestones work at mobile and desktop widths;
  returning to Profile refreshes the balance.

## Implementation checklist

### 1. Backend public contract

- [x] Add `src/service/credits/check-in.controller.ts` for `GET /check-in` and
  `POST /check-in`, remove the old nested route, and preserve
  `/credits/debits`, `/credits/balance`, and `/credits/ledger`.
- [x] Extend `src/service/credits/credit.dto.ts` with validated `YYYY-MM` query
  input and explicit status/milestone response DTOs.
- [x] Extend `CreditsService` in
  `src/domain/credits/credits.service.ts` with selected-month status/history
  derived from `CreditCheckIn`, `dailyCheckInCredits`, and
  `checkInMilestoneBonuses`; keep `checkIn` as the only writer.
- [x] Update `src/service/swagger.ts` to classify the root `check-in` path under
  the existing credit tag.
- [x] Update `test/swagger.e2e-spec.ts` to require `/check-in` and reject the
  removed `/credits/check-in` path.
- [x] Add `test/check-in.e2e-spec.ts` for query validation, current/past month
  history, reward/milestone projection, authentication, successful reward,
  GET-after-POST consistency, and duplicate 409 behavior without touching the
  user's current `test/credits.e2e-spec.ts` work.
- Narrow verification:
  `npm run test:e2e -- test/swagger.e2e-spec.ts test/check-in.e2e-spec.ts` and
  `npm run build`.

### 2. Web API and mock vertical slice

- [x] Initialize the pinned `opod-web` submodule before source edits.
- [x] Add `CreditCheckInResult` to `src/api-client/types.ts` and
  add status/milestone types plus `creditService.checkInStatus(month?)` and
  `creditService.checkIn()` in `src/api-client/services/credit-service.ts`.
- [x] Add `tests/creditService.spec.ts` to protect the exact endpoint, method,
  month query encoding, and response passthrough contracts.
- [x] Extend `src/mocks/data.ts` and `src/mocks/handlers.ts` with a within-session
  check-in state: GET returns monthly dates/milestones, first POST grants
  credits and updates both history and balance, and subsequent POST returns
  409.
- [x] Update `src/api-client/README.md` and `src/mocks/README.md` so their
  supported endpoint lists stay accurate.
- Narrow verification: `pnpm exec playwright test tests/creditService.spec.ts`.

### 3. Existing-system attendance UI

- [x] Add `src/app/profile/check-in/page.tsx` using `MainLayout` with back
  navigation and the title `출석체크`.
- [x] Add `src/domains/profile/CheckInContent.tsx` using existing dark tokens,
  `CalendarCheck`, card/radius vocabulary, and the shared `Button`. Implement
  month navigation, semantic calendar, milestone progress, automatic entry
  submission, success, duplicate-complete, and retryable-error states.
- [x] Change the attendance row in
  `src/domains/profile/SettingsList.tsx` from the `soon` toast to a status-aware
  `시작하기` / `완료` hint and `router.push('/profile/check-in')`.
- [x] Set the Profile query in `src/domains/profile/ProfileContent.tsx` to
  refresh from the network on remount so the rewarded balance is reconciled
  when the user returns.
- Visual verification: run the MSW-backed web app and inspect the initial,
  loading, success, duplicate, and error/retry states at a mobile viewport and
  the existing `max-w-2xl` desktop shell. Confirm keyboard focus and no new
  hardcoded design values.

### 4. Full verification and review

- [ ] Backend: `npm run format`, `npm run lint`, `npm run test`,
  `npm run test:e2e`, `npm run build`.
  Format, lint, 194 unit tests, build, and the new check-in/Swagger E2E suites
  pass. The full E2E run remains red on four pre-existing auth/messages cases.
- [x] Web: `pnpm lint`, `pnpm exec playwright test`, `pnpm build`.
- [x] Inspect scoped diffs in the backend, web submodule, and parent gitlink;
  preserve unrelated payment work already present in the backend.

## Decision ledger

| ID | Decision | Source | Status |
| --- | --- | --- | --- |
| CI-1 | Replace the old API with `POST /check-in`; no alias | user-confirmed | active |
| CI-2 | Implement the UI in `opod-web` at `/profile/check-in` | repo-evidenced | active |
| CI-3 | `GET /check-in?month=YYYY-MM` owns today state, monthly history, rewards, and milestones | session-goal scope | active |
| CI-4 | Reuse current tokens, `MainLayout`, `Button`, and settings navigation | repo-evidenced | active |
| CI-5 | Do not modify `opod-app` or database schema | repo-evidenced | active |
| CI-6 | Defer streaks, recovery, reminders, and separate reward claiming | scoped deferral | active |

Blocking decisions remaining: 0.
