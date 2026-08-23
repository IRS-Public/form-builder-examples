package gov.irs.benefitsenrollment

import org.scalatest.flatspec.AnyFlatSpec

/** The two overlapping populations.
  *
  * The prototype tracked these as two hand-entered integers, `householdSize` and `householdShareMeals`, and then capped
  * the visible person panels with a DOM removal loop. Both counts are derived here from `Filter` aliases over one
  * collection, which is what makes the prototype's person5 / person6 off-by-one errors unrepresentable rather than
  * fixed.
  *
  * This suite exists to prove the population model before any flow gate depends on it.
  */
class PopulationsSpec extends AnyFlatSpec with TestHelpers {

  "the population filters" should "separate the tax household from the meal-share household" in {
    val graph = newGraph()
    // The filer: files taxes together, shares meals.
    addPerson(graph, isSelf = true, isApplicant = true, inTaxHousehold = true, sharesMeals = true)
    // A child: in the tax household, shares meals.
    addPerson(graph, isApplicant = true, inTaxHousehold = true, sharesMeals = true)
    // A parent who files separately but eats with them — meal-share only.
    addPerson(graph, inTaxHousehold = false, sharesMeals = true)
    // A student claimed on the return who lives away and buys their own food.
    addPerson(graph, inTaxHousehold = true, sharesMeals = false)

    intAt(graph, "/householdMemberCount") shouldBe Some(4)
    intAt(graph, "/taxHouseholdSize") shouldBe Some(3)
    intAt(graph, "/mealShareHouseholdSize") shouldBe Some(3)
    intAt(graph, "/countApplicants") shouldBe Some(2)
  }

  it should "find the people who share meals but are outside the tax household" in {
    val graph = newGraph()
    addPerson(graph, isSelf = true, inTaxHousehold = true, sharesMeals = true)
    addPerson(graph, inTaxHousehold = false, sharesMeals = true)
    addPerson(graph, inTaxHousehold = false, sharesMeals = true)

    // Filtering a filter. This is the population that gave household-meals-only-names.html its
    // reason to exist: people with no tax-household record to hang a name on.
    intAt(graph, "/mealShareOnlyCount") shouldBe Some(2)
  }

  // Two different answers on a fresh application, and the difference is worth knowing before you
  // write a gate. CollectionSize over the raw writable /householdMembers is incomplete, because an
  // unanswered Collection has no value yet. CollectionSize over a Filter alias is Some(0), because
  // filtering nothing yields an empty collection, which is a complete answer.
  //
  // This is why /flowHouseholdIsEmpty carries a Not(IsComplete(...)) arm alongside its size test:
  // relying on the size alone would leave the gate incomplete rather than true on a fresh
  // application, and the flow would then show nothing at all.
  it should "report an untouched household as empty rather than as a count of zero" in {
    val graph = newGraph()

    intAt(graph, "/householdMemberCount") shouldBe None
    intAt(graph, "/taxHouseholdSize") shouldBe Some(0)
    booleanAt(graph, "/flowHouseholdIsEmpty") shouldBe Some(true)
    booleanAt(graph, "/flowHasHouseholdMembers") shouldBe Some(false)
  }

  "the self guard" should "fire only when two people both claim to be the filer" in {
    val graph = newGraph()
    addPerson(graph, isSelf = true)
    addPerson(graph, isSelf = false)

    booleanAt(graph, "/flowMoreThanOnePersonMarkedAsSelf") shouldBe Some(false)

    addPerson(graph, isSelf = true)
    booleanAt(graph, "/flowMoreThanOnePersonMarkedAsSelf") shouldBe Some(true)
  }
}
