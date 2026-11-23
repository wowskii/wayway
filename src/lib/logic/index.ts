// Role 4 · logic & evaluation. Import from "@/lib/logic" (server side).
// The order the API routes call things in is described in docs/logic-integration.md.
export { blocks, checkOption, filterOptions, filterSpotsForTrip, hasBudget, routePaths, spotIndex } from "./constraints";
export type { CheckOptions, ConstraintMember, Issue, IssueCode, SafetySpot, SpotEvidence, SpotIndex } from "./constraints";
export { creditWeight, rankOptions, ratingMap, summarize } from "./metrics";
export type { Balances } from "./metrics";
export { settleCredits } from "./credits";
export { buildOptions, pickCandidateId } from "./options";
export type { BuildMember, BuildResult, CandidateLike } from "./options";
export { advancePoll, castVote, completeBallots, contractErrorCode, localDay, quorumNeeded, startPoll } from "./voting";
export type { Attempt, DefinitelyNoCounter, Guard, Outcome, Poll, StoredVote, VoteError } from "./voting";
export { itineraryFromOption, spentFromItinerary, travelMin } from "./itinerary";
export {
  estimateAccuracy, evaluateRun, literalPrivacyHits, memberPath, personaRating, privateCanaries,
  publicCardText, publicOptionFacts,
} from "./evaluation";
export type { Observation, Persona, RunRecord } from "./evaluation";
export {
  decisionRows, memberStateUpdates, optionSetFromRow, optionSetUpdate, pollFromRows, voteFromRow, voteToRow,
} from "./persistence";
