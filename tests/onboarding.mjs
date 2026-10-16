import assert from "node:assert/strict";
import { onboardingDay } from "../lib/onboarding-date.ts";
assert.equal(onboardingDay(new Date("2026-10-15T22:59:59Z")), "2026-10-15");
assert.equal(onboardingDay(new Date("2026-10-15T23:00:00Z")), "2026-10-16");
assert.equal(onboardingDay(new Date("2026-12-31T23:00:00Z")), "2027-01-01");
console.log("PASS: Lagos reminder-day boundaries, including year rollover.");
