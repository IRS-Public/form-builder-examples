package gov.irs.directfile

import gov.irs.factgraph.types.Dollar
import gov.irs.factgraph.types.Enum as FgEnum
import gov.irs.factgraph.Graph
import gov.irs.formbuilder.loadFactDictionary
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/** The determination, tested against the real fact dictionary rather than a mock of it.
  *
  * This is the pattern to copy for every rule your tool decides: build a graph, set the writable facts a taxpayer would
  * have answered, read the derived one. No flow, no browser, no HTML — a rule is a property of the fact dictionary, and
  * this is the level it is cheapest to be wrong at.
  *
  * Note the third case. A derived fact over an unanswered input is *incomplete*, not false, and the two mean different
  * things to a taxpayer: "you don't qualify" versus "we haven't asked yet". `.value` returns `None` for incomplete, so
  * assert on the Option rather than calling `.get`.
  */
class EligibilitySpec extends AnyFlatSpec with Matchers {

  private def newGraph(): Graph = Graph(loadFactDictionary(app).factDictionary)

  private def qualifies(graph: Graph): Option[Boolean] =
    graph.get("/qualifies").value.map(_.asInstanceOf[Boolean])

  "/qualifies" should "be true when the taxpayer is eligible and under the income limit" in {
    val graph = newGraph()
    graph.set("/chosenTaxYear", FgEnum("2025", "/taxYearOptions"))
    graph.set("/isEligible", true)
    graph.set("/income", Dollar(40000))

    qualifies(graph) shouldBe Some(true)
  }

  it should "be false when income is over the limit" in {
    val graph = newGraph()
    graph.set("/chosenTaxYear", FgEnum("2025", "/taxYearOptions"))
    graph.set("/isEligible", true)
    graph.set("/income", Dollar(60000))

    qualifies(graph) shouldBe Some(false)
  }

  it should "stay incomplete until income has been answered" in {
    val graph = newGraph()
    graph.set("/chosenTaxYear", FgEnum("2025", "/taxYearOptions"))
    graph.set("/isEligible", true)

    qualifies(graph) shouldBe None
  }
}
