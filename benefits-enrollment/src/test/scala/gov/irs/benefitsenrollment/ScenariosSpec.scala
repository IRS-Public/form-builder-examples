package gov.irs.benefitsenrollment

import gov.irs.factgraph.persisters.InMemoryPersister
import gov.irs.factgraph.Graph
import gov.irs.formbuilder.loadFactDictionary
import org.scalatest.flatspec.AnyFlatSpec

/** The committed scenario corpus.
  *
  * A scenario is loaded by the browser, not by the build, so nothing else would notice a file that had gone stale
  * against the fact dictionary — a renamed fact path, a dropped enum option, a tightened limit. These load each
  * committed file exactly as `fg-fact-graph.js` does and read the determinations back out.
  */
class ScenariosSpec extends AnyFlatSpec {

  private def load(filename: String): Graph =
    val json = os.read(app.scenariosDir / filename)
    Graph(loadFactDictionary(app).factDictionary, InMemoryPersister(json))

  private def boolAt(graph: Graph, path: String): Option[Boolean] =
    graph.get(path).value.map(_.asInstanceOf[Boolean])

  private def intAt(graph: Graph, path: String): Option[Int] =
    graph.get(path).value.map(v => BigDecimal(v.toString).toInt)

  "the corpus" should "be on disk, one file per scenario" in {
    for scenario <- Scenarios.all do
      assert(os.exists(app.scenariosDir / scenario.filename), s"missing ${scenario.filename}")
  }

  it should "match what the generator produces" in {
    // Regenerate with: sbt "Test/runMain gov.irs.benefitsenrollment.GenerateScenarios"
    for scenario <- Scenarios.all do
      val committed = os.read(app.scenariosDir / scenario.filename)
      assert(committed == GenerateScenarios.buildJson(scenario), s"${scenario.filename} is stale")
  }

  it should "contain no file the generator does not own" in {
    val onDisk = os.list(app.scenariosDir).filter(_.ext == "json").map(_.last).toSet
    assert(onDisk == Scenarios.all.map(_.filename).toSet)
  }

  it should "give every scenario a label that reads as a sentence in the picker" in {
    // Form Builder derives the menu label from the filename; underscores are the only separator it
    // splits on, so a hyphen or a camelCase stem reaches the user raw.
    for scenario <- Scenarios.all do
      assert(scenario.name.matches("[a-z0-9_]+"), s"${scenario.name} will not render as a label")
  }

  "single_adult_over_the_income_limit" should "fail the screener without knocking the applicant out" in {
    val graph = load("single_adult_over_the_income_limit.json")
    assert(boolAt(graph, "/isOverScreenerIncomeLimit").contains(true))
    assert(boolAt(graph, "/mayQualify").contains(false))
    // not-eligible.html said "we encourage you to continue" and offered a Continue button, so the
    // rest of the application must still be answerable.
    assert(boolAt(graph, "/agreeToTerms").contains(true))
  }

  "single_adult_under_the_income_limit" should "pass the screener" in {
    val graph = load("single_adult_under_the_income_limit.json")
    assert(boolAt(graph, "/isOverScreenerIncomeLimit").contains(false))
    assert(boolAt(graph, "/mayQualify").contains(true))
  }

  "family_of_four_both_programs" should "count four people in one tax household" in {
    val graph = load("family_of_four_both_programs.json")
    assert(intAt(graph, "/taxHouseholdSize").contains(4))
    assert(intAt(graph, "/mealShareHouseholdSize").contains(4))
    assert(intAt(graph, "/mealShareOnlyCount").contains(0))
    assert(intAt(graph, "/countApplicants").contains(4))
    assert(boolAt(graph, "/isApplyingForFoodAssistance").contains(true))
    assert(boolAt(graph, "/isApplyingForHealthcare").contains(true))
  }

  "pregnant_applicant_health_coverage_only" should "pass a screener that never asked for income" in {
    val graph = load("pregnant_applicant_health_coverage_only.json")
    assert(graph.get("/screenerHouseholdIncome").value.isEmpty, "income should never have been asked")
    assert(boolAt(graph, "/flowShouldAskScreenerIncome").contains(false))
    assert(boolAt(graph, "/mayQualify").contains(true))
    assert(intAt(graph, "/taxHouseholdSize").contains(1))
  }

  it should "open the pregnancy follow-up for the one member who declared it" in {
    val graph = load("pregnant_applicant_health_coverage_only.json")
    val id = graph.getCollectionPaths("/householdMembers/*").head
    assert(boolAt(graph, s"$id/flowShouldAskPregnancyDetail").contains(true))
    assert(intAt(graph, s"$id/babiesExpected").contains(2))
  }

  "roommates_who_share_meals" should "separate the two populations" in {
    val graph = load("roommates_who_share_meals.json")
    // The whole reason household-meals-only-names.html existed.
    assert(intAt(graph, "/taxHouseholdSize").contains(1))
    assert(intAt(graph, "/mealShareHouseholdSize").contains(3))
    assert(intAt(graph, "/mealShareOnlyCount").contains(2))
    assert(intAt(graph, "/countApplicants").contains(1))
  }

  "applying_on_behalf_of_a_neighbor" should "not ask the filer to add themselves" in {
    val graph = load("applying_on_behalf_of_a_neighbor.json")
    assert(intAt(graph, "/countPeopleMarkedAsSelf").contains(0))
    assert(boolAt(graph, "/isApplyingOnBehalfOfOthers").contains(true))
    // The warning is the one thing that must stay quiet here.
    assert(boolAt(graph, "/flowNobodyMarkedAsSelf").contains(false))
    assert(boolAt(graph, "/flowMoreThanOnePersonMarkedAsSelf").contains(false))
  }

  "lawful_permanent_resident_with_a_document" should "ask one member, and only that member, for a document" in {
    val graph = load("lawful_permanent_resident_with_a_document.json")
    val members = graph.getCollectionPaths("/householdMembers/*")
    val asked = members.filter(m => boolAt(graph, s"$m/flowNeedsImmigrationDocument").contains(true))
    assert(asked.size == 1)
    assert(boolAt(graph, s"${asked.head}/flowNeedsCitizenshipFollowUp").contains(true))
    // "Other" document type stays shut: the document chosen was an A-number.
    assert(boolAt(graph, s"${asked.head}/flowNeedsOtherDocumentType").contains(false))
  }

  "one_earner_with_three_jobs" should "total all three slots" in {
    val graph = load("one_earner_with_three_jobs.json")
    val earner = graph
      .getCollectionPaths("/householdMembers/*")
      .find(m => boolAt(graph, s"$m/isSelf").contains(true))
      .get
    assert(boolAt(graph, s"$earner/flowShouldAskSecondJob").contains(true))
    assert(boolAt(graph, s"$earner/flowShouldAskThirdJob").contains(true))
    assert(graph.get(s"$earner/totalJobWages").value.map(_.toString).contains("2950.00"))
  }
}
