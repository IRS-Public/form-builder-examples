// What Direct File tells taxpert about itself that is *behaviour* rather than *words*.
//
// The workspace is configured from templates/fragments/taxpert-config.html, because every label it
// carries goes through Thymeleaf's `#{...}` and is therefore resolved per locale at build time. One
// thing cannot live in a template: the fact-graph port, which is functions over window.factGraph.
// So the fragment supplies the copy, this file supplies the code, and the fragment imports it.
//
// Every user-visible string here arrives through `t`, the translator the fragment hands in. There
// is no English literal below, and there should not be one: a literal here would be English in the
// Spanish build, because website-static/ is served verbatim and never passes through Thymeleaf.

import { windowFactGraphAdapter } from '../../vendor/taxpert/shared/js/graph-adapter.js'
import { saveFactGraph } from '../../vendor/form-builder/flow-runtime/js/flow-runtime.js'

/**
 * The fact-graph port for this application.
 *
 * Reads need no options: the flow runtime sets `window.factGraph` and fires `fg-load` / `fg-update`
 * on `document`, which is what windowFactGraphAdapter() already defaults to. `save` is not
 * optional — a write that is not persisted is gone at the next navigation, and the library cannot
 * guess where this app keeps its graph.
 */
export const directFileGraph = windowFactGraphAdapter({ save: saveFactGraph })

/**
 * The outcomes the workspace follows, and the facts each one is made of.
 *
 * Five, and the shape is the point: a return is one outcome — refund or balance owed — and each of
 * the four credits Direct File computes is another, because "why is this number what it is" is the
 * question the Outcome tracker exists to answer, and the answer is almost always a credit.
 *
 * `rollupPath` is the one fact that *is* the outcome: the tracker draws a full ring once it settles
 * and a part-drawn one until then, so answering the flow visibly moves it. `outcome` says how to
 * speak the settled value — `boolean` where upstream has a fact that means yes-or-no, `value` where
 * the honest answer is a dollar amount and inventing a threshold to make it a boolean would be this
 * port editorialising. Each rollup stays in its own section too, so the expanded view shows the
 * answer beside the facts it came from.
 *
 * `/dueRefund` rather than a signed amount, for the headline: Direct File has no single fact that
 * runs positive for a refund and negative for a balance due. `/overpayment` and `/balanceDue` are
 * both clamped at zero by a `<GreaterOf>` — one of them is always $0 — so `signed` would have shown
 * "refund" forever. `/dueRefund` and `/owesBalance` are the booleans the flow itself branches its
 * payment-method screens on, which makes them the facts that already mean this.
 *
 * Every path below is checked against the dictionary by `make transpile`, so a fact upstream
 * renames fails the build rather than becoming a permanently unresolvable row.
 *
 * @param {(key: string) => string} t resolves a message key to this build's locale
 */
export function directFileDeterminations (t) {
  return [
    {
      id: 'return',
      label: t('workspace.outcomes.return'),
      rollupPath: '/dueRefund',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.refund-due'),
        false: t('workspace.outcomes.balance-owed'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.income-and-tax'),
          facts: [
            '/totalIncome',
            '/agi',
            '/taxableIncome',
            '/totalTax',
          ],
        },
        {
          heading: t('workspace.outcomes.payments-and-credits'),
          facts: [
            '/totalPayments',
            '/nonRefundableCredits',
            '/totalOtherPaymentsRefundableCredits',
          ],
        },
        {
          // Both amounts, because which one is the answer is exactly what /dueRefund decides.
          heading: t('workspace.outcomes.the-result'),
          facts: [
            '/overpayment',
            '/balanceDue',
            '/dueRefund',
            '/owesBalance',
          ],
        },
      ],
    },

    {
      id: 'eitc',
      label: t('workspace.outcomes.eitc'),
      rollupPath: '/eitcQualified',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.qualifies'),
        false: t('workspace.outcomes.does-not-qualify'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.eitc-eligibility'),
          facts: [
            '/maybeEligibleForEitc',
            '/numEitcQualifyingChildren',
            '/eitcQualified',
          ],
        },
        {
          heading: t('workspace.outcomes.eitc-amount'),
          facts: [
            '/earnedIncomeCredit',
          ],
        },
      ],
    },

    {
      // The rollup is the amount rather than an eligibility boolean: CTC and ODC are two credits
      // summed on one line, and a taxpayer can be eligible for one and not the other. The total is
      // the thing that either moved the return or did not.
      id: 'ctc-odc',
      label: t('workspace.outcomes.ctc-odc'),
      rollupPath: '/totalCtcAndOdc',
      outcome: { kind: 'value' },
      sections: [
        {
          heading: t('workspace.outcomes.ctc-odc-eligibility'),
          facts: [
            '/maybeEligibleForCtc',
            '/maybeEligibleForOdc',
            '/maxCtcAmount',
            '/maxOdcAmount',
          ],
        },
        {
          // The refundable half is a separate line on the return, and is why the credit can pay out
          // past the tax owed.
          heading: t('workspace.outcomes.ctc-odc-amount'),
          facts: [
            '/totalCtcAndOdc',
            '/additionalCtc',
          ],
        },
      ],
    },

    {
      id: 'cdcc',
      label: t('workspace.outcomes.cdcc'),
      rollupPath: '/isReceivingCdccCredit',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.receiving'),
        false: t('workspace.outcomes.not-receiving'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.cdcc-eligibility'),
          facts: [
            '/maybeEligibleForCdcc',
            '/cdccCountOfQualifyingPersons',
            '/isReceivingCdccCredit',
          ],
        },
        {
          heading: t('workspace.outcomes.cdcc-amount'),
          facts: [
            '/cdccTotalCredit',
          ],
        },
      ],
    },

    {
      // Non-refundable and refundable at once: the PTC can be repaid rather than paid, so the net
      // amount is the outcome and a boolean would hide the direction.
      id: 'ptc',
      label: t('workspace.outcomes.ptc'),
      rollupPath: '/netPtcAmount',
      outcome: { kind: 'value' },
      sections: [
        {
          heading: t('workspace.outcomes.ptc-eligibility'),
          facts: [
            '/maybeEligibleForPtc',
            '/hasPtcQualifyingPlan',
          ],
        },
        {
          heading: t('workspace.outcomes.ptc-amount'),
          facts: [
            '/annualPtcAllowed',
            '/netPtcAmount',
          ],
        },
      ],
    },
  ]
}
