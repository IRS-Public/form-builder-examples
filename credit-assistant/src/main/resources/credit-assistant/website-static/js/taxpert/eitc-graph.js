// What credit-assistant tells @taxpert/ui about itself that is *behaviour* rather than *words*.
//
// The workspace is configured from templates/fragments/taxpert-config.html, because every label it
// carries goes through Thymeleaf's `#{...}` and is therefore translated once per locale at build
// time. One thing cannot live in a template: the fact-graph port, which is functions over
// window.factGraph. So the fragment supplies the copy and this file supplies the code, and the
// fragment imports it.
//
// Each determination's `outcome` used to be the second of those — a function turning a raw fact
// value into a word. It is a declarative descriptor now (see @taxpert/ui's shared/js/outcome-kinds.js),
// which is what makes the determination list JSON end to end and therefore editable from the
// Workspace settings UI. The *translated words* still come from `t`, so this file still needs the
// fragment to hand it one.
//
// The *fact paths* are here too, and that is the point of the file. They used to exist twice: once
// in @taxpert/ui's outcome-determinations.js for the Outcome tracker, and once in
// ./audit-panel/eligibility-dashboard.js for the audit panel's Eligibility dashboard — the same
// twenty-three paths, in the same five groups, kept in step by hand. Both surfaces now read the one
// list: the tracker through config.determinations, the dashboard by reading that config back.
//
// Every string the two surfaces show comes in through `t`, the translator the fragment hands to
// eitcDeterminations(). Nothing here is user-visible English.

import { windowFactGraphAdapter } from '../../vendor/taxpert-ui/shared/js/graph-adapter.js'
import { saveFactGraph } from '../fg-fact-graph.js'

/**
 * The fact-graph port for this application.
 *
 * Reads need no options: credit-assistant *is* the host windowFactGraphAdapter() was written
 * against. `window.factGraph` and `window.loadFactGraph` are set by fg-fact-graph.js, and `fg-load`
 * / `fg-update` are the events it and fg-set.js fire. They are declared explicitly all the same, so
 * the page states its own contract rather than relying on the library's default happening to match.
 *
 * `save` is not optional. A write that is not persisted is gone at the next navigation, and this
 * app's saveFactGraph() does two things the library cannot guess: it writes sessionStorage under
 * this app's key, and it publishes on the BroadcastChannel that keeps Formative Studio's overlay in
 * step. That is exactly why the port takes it rather than reaching for a global.
 */
export const eitcGraph = windowFactGraphAdapter({ save: saveFactGraph })

// `/derivedFilingStatus` answers with the enum's own option name; these are the message keys for
// what each one is called in reading copy. A status the dictionary grows later is not here, and
// falls through to the graph's own value rather than being swallowed.
const FILING_STATUS_KEYS = new Map([
  ['single', 'workspace.filing-status.single'],
  ['marriedFilingJointly', 'workspace.filing-status.married-filing-jointly'],
  ['marriedFilingSeparately', 'workspace.filing-status.married-filing-separately'],
  ['headOfHousehold', 'workspace.filing-status.head-of-household'],
  ['qualifiedSurvivingSpouse', 'workspace.filing-status.qualified-surviving-spouse'],
])

/**
 * The three determinations the workspace follows, and the facts each one is made of.
 *
 * Regrouped from the two dashboards the audit panel drew into the three accordions the designs ask
 * for. The paths themselves are unchanged; what moved is which heading they sit under and how the
 * rollup is spoken:
 *
 *   old FS dashboard  → 'filing-status'             (Marital status · Household & filing intent)
 *   old DQ dashboard  → 'without-qualifying-child'  (Married not filing jointly · Age)
 *                     → 'qualifying-child'          (Age, with a qualifying child)
 *
 * Every determination has a `rollupPath` — the one fact that *is* the outcome. The tracker's icon is
 * green once that fact settles and a part-drawn ring until then, and `outcome` says how its raw
 * value is spoken — a `map` over the filing-status enum's options, and `boolean` for the two
 * disqualifiers, whose sense is inverted (disqualified means you do *not* qualify). The rollup also stays in its own section's fact list, so the
 * expanded view still shows it in place alongside the answers that feed it.
 *
 * Two keys are ours rather than @taxpert/ui's, and it ignores both: `dashboard` says which of the
 * audit panel's two legacy lists a determination's sections belong to, and a section's own
 * `rollupPath` is the fact that list marks as its conclusion.
 *
 * @param {(key: string) => string} t resolves a message key to this build's locale
 */
export function eitcDeterminations (t) {
  return [
    {
      id: 'filing-status',
      label: t('workspace.outcomes.filing-status'),
      rollupPath: '/derivedFilingStatus',
      dashboard: 'filing-status',
      outcome: {
        kind: 'map',
        values: Object.fromEntries(
          [...FILING_STATUS_KEYS].map(([option, key]) => [option, t(key)])
        ),
      },
      sections: [
        {
          heading: t('workspace.outcomes.marital-status'),
          rollupPath: null,
          facts: [
            '/isSingle',
            '/isDivorcedOrLegallySeparated',
            '/maritalStatusAllowsFilingMarried',
            '/isWidowedInTaxYear',
            '/isWidowedInPastTwoTaxYears',
            '/isWidowedAtLeastTwoTaxYearsAgo',
          ],
        },
        {
          heading: t('workspace.outcomes.household-filing-intent'),
          rollupPath: '/derivedFilingStatus',
          facts: [
            '/intendsToFileJointly',
            '/spouseLivedWithTaxpayerLastSixMonths',
            '/paidMoreThanHalfHomeCostsForChild',
            '/tentativelyHOHFromHomeUpkeep',
            '/entitledToPreviouslyFileJointReturn',
            '/canClaimChildAsDependentInCurrentTaxYear',
            '/couldClaimChildAsDependentInCurrentTaxYearWithExceptions',
            '/derivedFilingStatus',
          ],
        },
      ],
    },
    {
      id: 'without-qualifying-child',
      label: t('workspace.outcomes.without-qualifying-child'),
      // A disqualifier, so the outcome is its negation: disqualified means you do not qualify.
      rollupPath: '/isDisqualifiedForEitcAgeWithoutQualifyingChildren',
      dashboard: 'disqualification',
      outcome: { kind: 'boolean', true: t('components.boolean.no'), false: t('components.boolean.yes') },
      sections: [
        {
          heading: t('workspace.outcomes.married-not-filing-jointly'),
          rollupPath: '/isDisqualifiedMarriedNotFilingJointly',
          facts: [
            '/isDisqualifiedFlowSeparationTestNotMarriedLivedNotSeparated',
            '/isDisqualifiedHohMarriedLivedTogetherNotSeparatedNoQcs',
            '/isDisqualifiedMfsLivedNotSeparatedNoQcs',
            '/isDisqualifiedMfsSameResidenceNotSeparated',
            '/isDisqualifiedInitialMfsLivedNotSeparated',
            '/isDisqualifiedHohMarriedLivedTogetherNotSeparated',
            '/isDisqualifiedMarriedNotMfjSameResidenceSeparatedNoQcs',
            '/isDisqualifiedWidowedNotJointlySameResidenceSeparatedNoQcs',
            '/isDisqualifiedWidowedNotJointlyDifferentResidenceNoQcs',
            '/isDisqualifiedMfsDifferentResidenceNoQcs',
            '/isDisqualifiedMfsOrHohSpouseDidNotLiveNoQcs',
            '/isDisqualifiedHohMarriedSeparatedNoQcs',
            '/isDisqualifiedInitialAndFilingMfsSeparatedNoQcs',
            '/isDisqualifiedMarriedNotFilingJointly',
          ],
        },
        {
          heading: t('workspace.outcomes.age-without-qualifying-child'),
          rollupPath: '/isDisqualifiedForEitcAgeWithoutQualifyingChildren',
          facts: [
            '/userDeclinesEitcQualifyingChildrenForDisqualifier',
            '/filingAllowsEitcWithoutQualifyingChildrenForDisqualifier',
            '/notBlockedAsDependentForEitcForDisqualifier',
            '/failsEitcAgeBandWithoutQualifyingChildren',
            '/primaryFilerIsClaimingQualifyingChildren',
            '/isDisqualifiedForEitcAgeWithoutQualifyingChildren',
          ],
        },
      ],
    },
    {
      id: 'qualifying-child',
      label: t('workspace.outcomes.qualifying-child'),
      rollupPath: '/isDisqualifiedForEitcAgeWithQualifyingChildren',
      dashboard: 'disqualification',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.not-qualified'),
        false: t('workspace.outcomes.qualified'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.age-with-qualifying-child'),
          rollupPath: '/isDisqualifiedForEitcAgeWithQualifyingChildren',
          facts: [
            '/hasQcAndShouldSeeAgeComparisonTest',
            '/eitcQualifyingChildren',
            '/isDisqualifiedForEitcAgeWithQualifyingChildren',
          ],
        },
      ],
    },
  ]
}
