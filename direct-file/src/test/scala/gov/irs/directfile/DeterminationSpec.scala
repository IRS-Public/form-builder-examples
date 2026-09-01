package gov.irs.directfile

import gov.irs.factgraph.persisters.InMemoryPersister
import gov.irs.factgraph.types.*
import gov.irs.factgraph.Graph
import gov.irs.formbuilder.loadFactDictionary
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/** Direct File's own arithmetic, run against this port's copy of its fact dictionary.
  *
  * The cookiecutter left an `EligibilitySpec` here asserting a `/qualifies` fact, which is the starter flow's rule and
  * not one this dictionary has ever declared. It failed on every run from the moment the 36 real modules landed. This
  * replaces it, and the replacement is stronger than a hand-written graph would have been: the corpus in `scenarios/`
  * is 161 real returns, translated from the fixtures Direct File's own backend tests use (`make export-scenarios`), so
  * the inputs are upstream's rather than invented here.
  *
  * Three claims, in ascending order of what they would catch:
  *
  *   1. **Every scenario loads.** A fact the corpus writes that this dictionary does not declare, or declares with a
  *      different type, fails here. `export-scenarios` checks the same thing as it writes, but that is a manual
  *      regeneration against a checkout of Direct File; this is the committed gate, and it guards the other direction
  *      too — an edit to `facts/` that the corpus no longer fits.
  *   2. **The accounting closes.** `overpayment - balanceDue == totalPayments - totalTax` on all 161, and a refund is
  *      due exactly when there is an overpayment. These are properties of the return rather than of any one scenario,
  *      so they hold without anyone writing down an expected number.
  *   3. **Two named scenarios compute what their names say.** The pinned figures are the check that the arithmetic is
  *      not merely self-consistent — `HOH_32k_EITC` is a head-of-household return with one qualifying child and an
  *      earned income credit, `ats_1` a single filer with neither.
  *
  * No flow and no browser: a determination is a property of the fact dictionary, and this is the level it is cheapest
  * to be wrong at.
  */
class DeterminationSpec extends AnyFlatSpec with Matchers {

  private lazy val dictionary = loadFactDictionary(app).factDictionary

  private lazy val scenarios: Seq[os.Path] =
    os.list(app.scenariosDir).filter(_.ext == "json").sorted

  /** A scenario corpus file, loaded through this application's dictionary. */
  private def graphOf(scenario: os.Path): Graph =
    Graph(dictionary, InMemoryPersister(os.read(scenario)))

  private def dollar(graph: Graph, path: String): Option[Dollar] =
    graph.get(path).value.map(_.asInstanceOf[Dollar])

  private def boolean(graph: Graph, path: String): Option[Boolean] =
    graph.get(path).value.map(_.asInstanceOf[Boolean])

  "the scenario corpus" should "not be empty" in {
    // `scenarios/` holds a `.gitkeep` and nothing else until `make export-scenarios` has run against a Direct File
    // checkout. Asserted separately so an empty corpus reads as "the corpus is missing" rather than as 161 vacuously
    // passing invariants.
    scenarios should not be empty
  }

  it should "load every scenario against this dictionary" in {
    val unloadable = scenarios.flatMap { scenario =>
      scala.util.Try(graphOf(scenario)).failed.toOption.map(error => s"${scenario.last}: ${error.getMessage}")
    }
    unloadable shouldBe empty
  }

  "every scenario" should "balance payments against tax" in {
    // The identity a Form 1040 closes on. Stated over the corpus rather than over one return, because a rounding or
    // sign error in any one of the four facts shows up here and in no single assertion about a total.
    val violations = scenarios.flatMap { scenario =>
      val graph = graphOf(scenario)
      for {
        totalTax <- dollar(graph, "/totalTax")
        totalPayments <- dollar(graph, "/totalPayments")
        overpayment <- dollar(graph, "/overpayment")
        balanceDue <- dollar(graph, "/balanceDue")
        if overpayment - balanceDue != totalPayments - totalTax
      } yield s"${scenario.last}: $overpayment - $balanceDue != $totalPayments - $totalTax"
    }
    violations shouldBe empty
  }

  it should "owe a refund exactly when it has overpaid" in {
    val violations = scenarios.flatMap { scenario =>
      val graph = graphOf(scenario)
      for {
        overpayment <- dollar(graph, "/overpayment")
        dueRefund <- boolean(graph, "/dueRefund")
        if dueRefund != (overpayment > Dollar(0))
      } yield s"${scenario.last}: overpayment $overpayment, dueRefund $dueRefund"
    }
    violations shouldBe empty
  }

  "HOH_32k_EITC" should "be a head-of-household return with one qualifying child and an EITC" in {
    val graph = graphOf(app.scenariosDir / "HOH_32k_EITC.json")

    graph.get("/filingStatus").value.map(_.toString) shouldBe Some("headOfHousehold")
    graph.get("/numEitcQualifyingChildren").value shouldBe Some(1)
    boolean(graph, "/eitcQualified") shouldBe Some(true)
    dollar(graph, "/earnedIncomeCredit") shouldBe Some(Dollar(2726))
    dollar(graph, "/standardDeduction") shouldBe Some(Dollar(23850))
    boolean(graph, "/dueRefund") shouldBe Some(true)
  }

  "ats_1" should "be a single filer with no qualifying children and no EITC" in {
    // The negative case, and the reason there are two pinned scenarios rather than one: a credit that is always
    // awarded passes the first assertion just as well as a correct one does.
    val graph = graphOf(app.scenariosDir / "ats_1.json")

    graph.get("/filingStatus").value.map(_.toString) shouldBe Some("single")
    graph.get("/numEitcQualifyingChildren").value shouldBe Some(0)
    boolean(graph, "/eitcQualified") shouldBe Some(false)
    dollar(graph, "/earnedIncomeCredit") shouldBe Some(Dollar(0))
  }
}
