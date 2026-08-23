// What Benefits Enrollment tells taxpert about itself that is *behaviour* rather than *words*.
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
export const benefitsEnrollmentGraph = windowFactGraphAdapter({ save: saveFactGraph })

/**
 * The outcomes the workspace follows, and the facts each one is made of.
 *
 * `rollupPath` is the one fact that *is* the outcome: the Outcome tracker draws a full ring once it
 * settles and a part-drawn one until then, so answering the flow visibly moves it. `outcome`
 * describes how to say the settled value — `boolean` here; `signed` and `enum` are the other kinds.
 *
 * Each section is a heading and the facts under it, in the order a person would check them. Keep
 * the rollup in its own section too: the expanded view then shows the answer beside its inputs.
 *
 * @param {(key: string) => string} t resolves a message key to this build's locale
 */
export function benefitsEnrollmentDeterminations (t) {
  return [
    {
      id: 'eligibility',
      label: t('workspace.outcomes.eligibility'),
      rollupPath: '/mayQualify',
      outcome: {
        kind: 'boolean',
        true: t('workspace.outcomes.qualifies'),
        false: t('workspace.outcomes.does-not-qualify'),
      },
      sections: [
        {
          heading: t('workspace.outcomes.the-questions'),
          facts: [
            '/benefitChoices',
            '/screenerHouseholdIncome',
          ],
        },
        {
          heading: t('workspace.outcomes.the-test'),
          facts: [
            '/screenerIncomeLimit',
            '/isOverScreenerIncomeLimit',
            '/flowScreenerAnswered',
            '/mayQualify',
          ],
        },
      ],
    },
    {
      // The two overlapping populations, which the prototype tracked as two hand-entered integers
      // and this application derives from one collection. Worth its own outcome because the
      // difference between them is the thing most easily got wrong.
      id: 'household',
      label: t('workspace.outcomes.household'),
      rollupPath: '/householdMemberCount',
      outcome: { kind: 'signed' },
      sections: [
        {
          heading: t('workspace.outcomes.household'),
          facts: [
            '/householdMemberCount',
            '/taxHouseholdSize',
            '/mealShareHouseholdSize',
            '/mealShareOnlyCount',
            '/countApplicants',
          ],
        },
      ],
    },
  ]
}
