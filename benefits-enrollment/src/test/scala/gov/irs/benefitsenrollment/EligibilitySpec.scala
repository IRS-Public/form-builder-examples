package gov.irs.benefitsenrollment

import gov.irs.factgraph.types.Dollar
import org.scalatest.flatspec.AnyFlatSpec

/** The prototype's one formal eligibility rule, ported verbatim.
  *
  * `((householdIncome undefined AND foodAssistance=="no") OR householdIncome <= 10000)` routed to eligible.html, else
  * not-eligible.html — a single flat $10,000 cutoff over 30 days, not adjusted for household size and not varying by
  * program.
  *
  * Note the third case. A derived fact over an unanswered input is *incomplete*, not false, and the two mean different
  * things to an applicant: "you may not qualify" versus "we have not asked yet".
  */
class EligibilitySpec extends AnyFlatSpec with TestHelpers {

  "the screener" should "flag a SNAP applicant over the limit" in {
    val graph = newGraph()
    chooseBenefits(graph, "foodAssistance")
    graph.set("/screenerHouseholdIncome", Dollar(12000))

    booleanAt(graph, "/isOverScreenerIncomeLimit") shouldBe Some(true)
    booleanAt(graph, "/mayQualify") shouldBe Some(false)
  }

  it should "pass a SNAP applicant under the limit" in {
    val graph = newGraph()
    chooseBenefits(graph, "foodAssistance")
    graph.set("/screenerHouseholdIncome", Dollar(2500))

    booleanAt(graph, "/isOverScreenerIncomeLimit") shouldBe Some(false)
    booleanAt(graph, "/mayQualify") shouldBe Some(true)
  }

  it should "treat the limit as inclusive, exactly as the prototype's <= did" in {
    val graph = newGraph()
    chooseBenefits(graph, "foodAssistance")
    graph.set("/screenerHouseholdIncome", Dollar(10000))

    booleanAt(graph, "/isOverScreenerIncomeLimit") shouldBe Some(false)
  }

  // The Medicaid-only path never asked for income, so the rule's first arm always held. That
  // absence is the behaviour, not an oversight to correct.
  it should "pass a Medicaid-only applicant who was never asked for income" in {
    val graph = newGraph()
    chooseBenefits(graph, "healthcare")

    booleanAt(graph, "/isOverScreenerIncomeLimit") shouldBe Some(false)
    booleanAt(graph, "/mayQualify") shouldBe Some(true)
  }

  // All short-circuits on a false member, so the IsComplete guard makes this read false rather
  // than incomplete while the question is unanswered. That is what the Medicaid-only path needs,
  // and it is why the outcome alerts gate on /flowScreenerAnswered instead of on this fact.
  it should "read false, not incomplete, before a SNAP applicant has answered" in {
    val graph = newGraph()
    chooseBenefits(graph, "foodAssistance")

    booleanAt(graph, "/isOverScreenerIncomeLimit") shouldBe Some(false)
    booleanAt(graph, "/flowScreenerAnswered") shouldBe Some(false)
    booleanAt(graph, "/mayQualify") shouldBe Some(false)
  }

  it should "hold off on an outcome until a benefit has even been chosen" in {
    val graph = newGraph()

    booleanAt(graph, "/flowScreenerAnswered") shouldBe None
  }
}
