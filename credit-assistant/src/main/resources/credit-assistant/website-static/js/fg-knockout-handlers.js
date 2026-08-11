// This application's knockout gates — the four places where the first Continue reveals a knockout
// in place instead of navigating.
//
// The mechanism is taxpert's (`revealOnContinue` builds the handler, `registerContinueHandler`
// puts it in the Continue chain, and `validateSectionForNavigation` is what blocks every *later*
// Continue while the revealed knockout is on screen). What is left here is the part that is
// genuinely EITC: which route, which fact says the knockout applies, and which fact records that
// they already pressed Continue once.
//
// These were four near-identical 40-line functions inside the shared runtime. They are four rows of
// data now, and the runtime no longer knows any of these paths.

import {
  registerContinueHandler,
  revealOnContinue,
} from '../vendor/formative/flow-runtime/js/continue-handlers.js'

const gates = [
  // Income page, while earned income is non-positive.
  {
    route: '/eitc/agi',
    gatePath: '/flowShouldShowNonPositiveEarnedIncomeKnockout',
    clickedPath: '/flowClickedNextOnIncomePageForNonPositiveEarnedIncomeKnockout',
  },
  // Qualifying Children, when the add-child required-QC knockout condition holds.
  {
    route: '/eitc/qualifying-children',
    gatePath: '/flowShouldShowQcRequiredAddChildKnockout',
    clickedPath: '/flowClickedNextOnQualifyingChildrenPage',
  },
  // Qualifying Children, when final AGI/earned income is at or above the completed phase-out line.
  {
    route: '/eitc/qualifying-children',
    gatePath: '/flowShouldRevealEitcIncomeLimitOnQualifyingChildrenContinue',
    clickedPath: '/flowClickedNextOnQualifyingChildrenPageForIncomeLimit',
  },
  // Adjustments, while over the tentative EITC AGI limit. This gate is phrased the other way round
  // from the three above — the fact is true when the taxpayer is *below* the limit — so the
  // knockout is revealed when it reads false.
  {
    route: '/eitc/adjustments',
    gatePath: '/belowHighestEitcAgiLimit',
    clickedPath: '/flowClickedNextOnAdjustmentsPage',
    revealWhen: (value) => value !== true,
  },
]

for (const gate of gates) registerContinueHandler(revealOnContinue(gate))
