// What the Tax Withholding Estimator tells taxpert about itself that is *behaviour* rather
// than *words*.
//
// The workspace is configured from templates/fragments/taxpert-config.html, because every label it
// carries goes through Thymeleaf's `#{...}` and is therefore resolved per locale (en/es) at build
// time. One thing cannot live in a template: the fact-graph port, which is functions over
// window.factGraph. So the fragment supplies the copy and this file supplies the code, and the
// fragment imports it. Every user-visible string here arrives through `t`, the translator the
// fragment hands in; there is no English literal below.
//
// The *fact paths* are here too. They are the whole reason taxpert had to become
// configuration-driven: they used to be one other application's twenty-three paths, compiled into
// the library, which meant this app's Outcome tracker would have shown three permanently
// unresolvable rows. Now the library ships none and this file supplies TWE's.

import { windowFactGraphAdapter } from '../../vendor/taxpert/shared/js/graph-adapter.js'
import { saveFactGraph } from '../../vendor/taxpert/flow-runtime/js/flow-runtime.js'

/**
 * The fact-graph port for this application.
 *
 * Reads need no options: fg-components.js sets `window.factGraph` and `window.loadFactGraph` and
 * fires `fg-load` / `fg-update` on `document`, which is exactly what windowFactGraphAdapter()
 * defaults to. They are stated explicitly all the same, so the page declares its own contract
 * rather than relying on the library's default happening to match.
 *
 * `save` is not optional. A write that is not persisted is gone at the next navigation, and
 * saveFactGraph() is this app's — it writes sessionStorage under this app's own key. The library
 * cannot guess it, which is why the port takes it rather than reaching for a global.
 */
export const tweGraph = windowFactGraphAdapter({ save: saveFactGraph })

/**
 * The three outcomes the workspace follows, and the facts each one is made of.
 *
 * TWE's are shaped unlike the other host's in one way worth naming: its headline outcome is a
 * **Dollar**, not a boolean or an enum. `/withholdingGap` is positive when too little has been
 * withheld (a balance due), negative when too much has (a refund), zero when the year lands on
 * target. That is the `signed` outcome kind, and the reason it exists: the two direction templates
 * carry `{abs}`, which taxpert fills with fact-values.js's formatted value minus its sign
 * ('$1,240'), so the words read naturally in either direction while the tracker's settled/pending
 * ring keeps working off the ordinary fact status.
 *
 * `rollupPath` is the one fact that *is* the outcome: the tracker draws a full ring once it
 * settles and a part-drawn one until then. Each rollup also stays in its own section's fact list,
 * so the expanded view still shows it in place alongside the answers that feed it.
 *
 * @param {(key: string) => string} t resolves a message key to this build's locale
 */
export function tweDeterminations (t) {
  return [
    {
      id: 'withholding-outcome',
      label: t('workspace.outcomes.withholding-outcome'),
      rollupPath: '/withholdingGap',
      // The two direction strings are templates, not fragments: '{abs}' is where the amount goes,
      // so a locale is free to put it somewhere other than the end.
      outcome: {
        kind: 'signed',
        positive: t('workspace.outcomes.balance-due'),
        negative: t('workspace.outcomes.refund'),
        zero: t('workspace.outcomes.on-target'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.owed-vs-withheld'),
          facts: [
            '/totalOwed',
            '/totalEndOfYearProjectedWithholding',
            '/withholdingGap',
          ],
        },
        {
          heading: t('workspace.outcomes.direction'),
          facts: [
            '/isOverwithheld',
            '/isUnderwithheld',
            '/isZeroRefund',
            '/withholdingSurplus',
          ],
        },
      ],
    },
    {
      id: 'underpayment-risk',
      label: t('workspace.outcomes.underpayment-risk'),
      rollupPath: '/mayBeSubjectToUnderpaymentPenalty',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.at-risk'),
        false: t('workspace.outcomes.not-at-risk'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.penalty-thresholds'),
          facts: [
            '/owesAtleast1000Dollars',
            '/owesAtleast10PercentOfTotalTax',
            '/10PercentOfTotalTax',
            '/totalTax',
            '/mayBeSubjectToUnderpaymentPenalty',
          ],
        },
      ],
    },
    {
      id: 'adjustment-headroom',
      label: t('workspace.outcomes.adjustment-headroom'),
      // Whether there is any pay left this year to withhold more from. Once this settles false the
      // only lever remaining is an estimated payment, which is why the second section is there.
      rollupPath: '/eligibleRemainingPayPeriodsGreaterThanZero',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.can-adjust'),
        false: t('workspace.outcomes.estimated-payments-only'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.remaining-pay-periods'),
          facts: [
            '/hasJobsAvailableForExtraWithholding',
            '/hasPensionsAvailableForExtraWithholding',
            '/eligibleRemainingPayPeriodsGreaterThanZero',
          ],
        },
        {
          heading: t('workspace.outcomes.estimated-payments'),
          facts: [
            '/withholdingAmountPerPayPeriodTotalForJobsAndPensions',
            '/mayNeedToMakeEstimatedPayments',
          ],
        },
      ],
    },
  ]
}
