package gov.irs.benefitsenrollment

import gov.irs.factgraph.types.Enum as FgEnum
import gov.irs.factgraph.types.MultiEnum
import org.scalatest.flatspec.AnyFlatSpec

/** The branches the prototype expressed as `window.location.href`.
  *
  * Every one of them is now a Boolean the flow gates on, so the branch table is testable without a browser. The cases
  * below are named after the prototype page whose script they replace.
  */
class FlowGatesSpec extends AnyFlatSpec with TestHelpers {

  // quick-screener.html hid the income field behind .snap-only.
  "the screener income gate" should "follow the program choice" in {
    val snap = newGraph()
    chooseBenefits(snap, "foodAssistance")
    booleanAt(snap, "/flowShouldAskScreenerIncome") shouldBe Some(true)

    val medicaid = newGraph()
    chooseBenefits(medicaid, "healthcare")
    booleanAt(medicaid, "/flowShouldAskScreenerIncome") shouldBe Some(false)

    val both = newGraph()
    chooseBenefits(both, "foodAssistance", "healthcare")
    booleanAt(both, "/flowShouldAskScreenerIncome") shouldBe Some(true)
  }

  "the benefit-choice guard" should "reject an empty selection" in {
    val graph = newGraph()
    graph.set("/benefitChoices", MultiEnum(Set.empty[String], "/benefitOptions"))

    booleanAt(graph, "/hasChosenABenefit") shouldBe Some(false)
  }

  // applicant-common-cases.html branch 1:
  //   applyingFor=="Myself" && householdSize==1 && householdShareMeals==0 -> skip to finances.
  "the lone-applicant gate" should "fire for one person who shares meals with nobody" in {
    val graph = newGraph()
    graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
    addPerson(graph, isSelf = true, isApplicant = true, inTaxHousehold = true, sharesMeals = false)

    booleanAt(graph, "/flowHouseholdIsJustTheApplicant") shouldBe Some(true)
  }

  it should "not fire once a second person is in the tax household" in {
    val graph = newGraph()
    graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
    addPerson(graph, isSelf = true, isApplicant = true, sharesMeals = false)
    addPerson(graph, sharesMeals = false)

    booleanAt(graph, "/flowHouseholdIsJustTheApplicant") shouldBe Some(false)
  }

  it should "not fire when somebody shares meals, even if the tax household is one person" in {
    val graph = newGraph()
    graph.set("/applyingFor", FgEnum("myself", "/applyingForOptions"))
    addPerson(graph, isSelf = true, isApplicant = true, inTaxHousehold = true, sharesMeals = true)

    booleanAt(graph, "/flowHouseholdIsJustTheApplicant") shouldBe Some(false)
  }

  // household-mealshare-review.html and its two naming pages were SNAP-only.
  "the meal-share gate" should "need both a food-assistance application and somebody to ask about" in {
    val empty = newGraph()
    chooseBenefits(empty, "foodAssistance")
    booleanAt(empty, "/flowShouldAskAboutMealSharing") shouldBe Some(false)

    val medicaid = newGraph()
    chooseBenefits(medicaid, "healthcare")
    addPerson(medicaid, isSelf = true)
    booleanAt(medicaid, "/flowShouldAskAboutMealSharing") shouldBe Some(false)

    val snap = newGraph()
    chooseBenefits(snap, "foodAssistance")
    addPerson(snap, isSelf = true)
    booleanAt(snap, "/flowShouldAskAboutMealSharing") shouldBe Some(true)
  }

  // expenses.html removed #if-shares-meals when householdShareMeals was 0.
  "the meal-share expense gate" should "follow whether anyone actually shares meals" in {
    val alone = newGraph()
    chooseBenefits(alone, "foodAssistance")
    addPerson(alone, isSelf = true, sharesMeals = false)
    booleanAt(alone, "/flowShouldAskMealShareExpenses") shouldBe Some(false)

    val shared = newGraph()
    chooseBenefits(shared, "foodAssistance")
    addPerson(shared, isSelf = true, sharesMeals = true)
    booleanAt(shared, "/flowShouldAskMealShareExpenses") shouldBe Some(true)
  }

  // personN-step1.html hid the SSN block behind .applicant-only.
  "the per-person SSN gate" should "follow whether that person is applying" in {
    val graph = newGraph()
    val applicant = addPerson(graph, isApplicant = true)
    val context = addPerson(graph, isApplicant = false)

    booleanAt(graph, s"/householdMembers/#$applicant/flowShouldAskSsn") shouldBe Some(true)
    booleanAt(graph, s"/householdMembers/#$context/flowShouldAskSsn") shouldBe Some(false)
  }

  // personN-step2.html resolved pregnancy and insurance with a cascading override in which the
  // last true test won, because a page can only navigate to one place. They are independent here.
  "pregnancy and insurance detail" should "be gated separately rather than competing" in {
    val graph = newGraph()
    val id = addPerson(graph)
    val p = s"/householdMembers/#$id"
    graph.set(s"$p/sex", FgEnum("female", "/sexOptions"))
    graph.set(s"$p/commonCases", MultiEnum(Set("pregnant", "insurance"), "/commonCaseOptions"))

    booleanAt(graph, s"$p/flowShouldAskPregnancyDetail") shouldBe Some(true)
    booleanAt(graph, s"$p/flowShouldAskInsuranceDetail") shouldBe Some(true)
  }

  it should "not ask a male household member about a pregnancy" in {
    val graph = newGraph()
    val id = addPerson(graph)
    val p = s"/householdMembers/#$id"
    graph.set(s"$p/sex", FgEnum("male", "/sexOptions"))
    graph.set(s"$p/commonCases", MultiEnum(Set("pregnant"), "/commonCaseOptions"))

    booleanAt(graph, s"$p/flowShouldAskPregnancyDetail") shouldBe Some(false)
  }

  // determine-who.html plus six follow-up pages, each re-implementing an ascending else-if chain
  // so every flagged non-citizen was visited exactly once. All of it was iteration.
  "the citizenship follow-up gate" should "chain status, then document, then document type" in {
    val graph = newGraph()
    val id = addPerson(graph)
    val p = s"/householdMembers/#$id"

    graph.set(s"$p/isCitizen", true)
    booleanAt(graph, s"$p/flowNeedsCitizenshipFollowUp") shouldBe Some(false)

    graph.set(s"$p/isCitizen", false)
    booleanAt(graph, s"$p/flowNeedsCitizenshipFollowUp") shouldBe Some(true)
    assertGateOff(graph, s"$p/flowNeedsImmigrationDocument")

    graph.set(s"$p/hasEligibleImmigrationStatus", true)
    booleanAt(graph, s"$p/flowNeedsImmigrationDocument") shouldBe Some(true)
    // Incomplete rather than false: All is false only when a member is false, and the document
    // type has not been chosen yet. A gate being off covers both, which is why it has its own
    // assertion rather than being spelled shouldBe Some(false).
    assertGateOff(graph, s"$p/flowNeedsOtherDocumentType")

    graph.set(s"$p/immigrationDocument", FgEnum("other", "/immigrationDocumentOptions"))
    booleanAt(graph, s"$p/flowNeedsOtherDocumentType") shouldBe Some(true)
  }

  // job-details-1 -> -2 -> -3, and their six per-person duplicates.
  "the job slots" should "unlock one at a time" in {
    val graph = newGraph()
    val id = addPerson(graph)
    val p = s"/householdMembers/#$id"

    graph.set(s"$p/incomeTypes", MultiEnum(Set("job"), "/incomeTypeOptions"))
    booleanAt(graph, s"$p/flowShouldAskJobDetails") shouldBe Some(true)
    booleanAt(graph, s"$p/flowShouldAskSecondJob") shouldBe Some(false)

    graph.set(s"$p/hasSecondJob", true)
    booleanAt(graph, s"$p/flowShouldAskSecondJob") shouldBe Some(true)
    booleanAt(graph, s"$p/flowShouldAskThirdJob") shouldBe Some(false)

    graph.set(s"$p/hasThirdJob", true)
    booleanAt(graph, s"$p/flowShouldAskThirdJob") shouldBe Some(true)
  }

  it should "stay shut for somebody with no job income" in {
    val graph = newGraph()
    val id = addPerson(graph)
    val p = s"/householdMembers/#$id"
    graph.set(s"$p/incomeTypes", MultiEnum(Set("socialSecurity"), "/incomeTypeOptions"))

    booleanAt(graph, s"$p/flowShouldAskJobDetails") shouldBe Some(false)
  }

  "the relationship gate" should "not ask the filer how they are related to themselves" in {
    val graph = newGraph()
    val self = addPerson(graph, isSelf = true)
    val other = addPerson(graph, isSelf = false)

    booleanAt(graph, s"/householdMembers/#$self/flowIsNotSelf") shouldBe Some(false)
    booleanAt(graph, s"/householdMembers/#$other/flowIsNotSelf") shouldBe Some(true)
  }
}
