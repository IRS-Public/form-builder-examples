const DQ_MARRIED_NOT_JOINT_FACTS = [
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
]

const DQ_AGE_WITHOUT_QC_FACTS = [
  '/userDeclinesEitcQualifyingChildrenForDisqualifier',
  '/filingAllowsEitcWithoutQualifyingChildrenForDisqualifier',
  '/notBlockedAsDependentForEitcForDisqualifier',
  '/failsEitcAgeBandWithoutQualifyingChildren',
  '/primaryFilerIsClaimingQualifyingChildren',
  '/isDisqualifiedForEitcAgeWithoutQualifyingChildren',
]

const DQ_AGE_WITH_QC_FACTS = [
  '/hasQcAndShouldSeeAgeComparisonTest',
  '/eitcQualifyingChildren',
  '/isDisqualifiedForEitcAgeWithQualifyingChildren',
]

const FS_MARITAL_STATUS_FACTS = [
  '/isSingle',
  '/isDivorcedOrLegallySeparated',
  '/maritalStatusAllowsFilingMarried',
  '/isWidowedInTaxYear',
  '/isWidowedInPastTwoTaxYears',
  '/isWidowedAtLeastTwoTaxYearsAgo',
]

const FS_HOUSEHOLD_FACTS = [
  '/intendsToFileJointly',
  '/spouseLivedWithTaxpayerLastSixMonths',
  '/paidMoreThanHalfHomeCostsForChild',
  '/tentativelyHOHFromHomeUpkeep',
  '/entitledToPreviouslyFileJointReturn',
  '/canClaimChildAsDependentInCurrentTaxYear',
  '/couldClaimChildAsDependentInCurrentTaxYearWithExceptions',
  '/derivedFilingStatus',
]

function renderDashboardSection (facts, rollupPath, heading, getStatus) {
  const items = facts
    .map((p) => {
      let status = 'incomplete'
      let badge = 'incomplete'
      try {
        const fact = window.factGraph.get(p)
        if (fact.complete) {
          const val = fact.get.toString()
          if (getStatus) {
            const result = getStatus(p, val)
            status = result.status
            badge = result.badge ?? result.status
          } else {
            status = p.startsWith('/isDisqualified')
              ? val === 'true'
                ? 'disqualified'
                : 'passed'
              : val === 'true'
                ? 'passed'
                : 'failed'
            badge = status
          }
        }
      } catch {}
      const isRollup = p === rollupPath
      return `<li class="ap-dq-item ap-dq-${status}${isRollup ? ' ap-dq-rollup' : ''}" title="${p}">
        <span class="ap-dq-label">${p}</span>
        <span class="ap-dq-badge ap-dq-badge--${status}">${badge}</span>
      </li>`
    })
    .join('')
  return `<li class="ap-dq-section-heading">${heading}</li>${items}`
}

function renderDQDashboard () {
  const list = document.querySelector('#dq-dashboard-list-nested')
  if (!list || !window.factGraph) return

  list.innerHTML = [
    renderDashboardSection(
      DQ_MARRIED_NOT_JOINT_FACTS,
      '/isDisqualifiedMarriedNotFilingJointly',
      'Married Not Joint'
    ),
    renderDashboardSection(
      DQ_AGE_WITHOUT_QC_FACTS,
      '/isDisqualifiedForEitcAgeWithoutQualifyingChildren',
      'Age (No QC)'
    ),
    renderDashboardSection(
      DQ_AGE_WITH_QC_FACTS,
      '/isDisqualifiedForEitcAgeWithQualifyingChildren',
      'Age (With QC)'
    ),
  ].join('')
}

function fsFilingStatusLabel (val) {
  switch (val) {
    case 'marriedFilingJointly':
      return 'MFJ'
    case 'marriedFilingSeparately':
      return 'MFS'
    case 'single':
      return 'Single'
    case 'headOfHousehold':
      return 'HOH'
    case 'qualifiedSurvivingSpouse':
      return 'QSS'
    default:
      return val
  }
}

function fsDashboardStatus (path, val) {
  if (path === '/derivedFilingStatus') { return { status: 'resolved', badge: fsFilingStatusLabel(val) } }
  return { status: val === 'true' ? 'passed' : 'failed' }
}

/**
 * Re-render both eligibility dashboards (filing-status and disqualifier) from the live fact graph.
 * Wired to `fg-update`/`fg-load` so the panels stay in sync as answers change.
 */
function renderEligibilityDashboard () {
  renderFSDashboard()
  renderDQDashboard()
}
function renderFSDashboard () {
  const list = document.querySelector('#fs-dashboard-list-nested')
  if (!list || !window.factGraph) return

  list.innerHTML = [
    renderDashboardSection(
      FS_MARITAL_STATUS_FACTS,
      null,
      'Marital Status',
      fsDashboardStatus
    ),
    renderDashboardSection(
      FS_HOUSEHOLD_FACTS,
      '/derivedFilingStatus',
      'Household & Filing Intent',
      fsDashboardStatus
    ),
  ].join('')
}

document.addEventListener('fg-update', () => {
  renderEligibilityDashboard()
})
document.addEventListener('fg-load', () => {
  renderEligibilityDashboard()
})

// Exported so eligibility-dashboard-plugin.js can render once after building the section
// markup (the DQ/FS fact-path lists and rendering logic above are otherwise unchanged).
export { renderEligibilityDashboard }
