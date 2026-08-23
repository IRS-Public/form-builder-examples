package gov.irs.benefitsenrollment

import gov.irs.formbuilder.FormBuilder
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/** The flow parses, and every fact path it names resolves.
  *
  * This is the test worth having on day one. `parseFlow` validates each `path=` against the fact dictionary and throws
  * on one that does not exist; without it, a typo reaches the browser as a question that silently never settles, and
  * that is expensive to find by clicking. Everything else here is cheap insurance on top of that.
  */
class FlowSpec extends AnyFlatSpec with Matchers {

  private lazy val flow = FormBuilder.parseFlow(app)

  "the flow" should "parse every module named in index.xml, with every fact path resolving" in {
    flow.pages should not be empty
  }

  it should "give every page a unique route" in {
    val routes = flow.pages.map(_.route)
    routes.diff(routes.distinct) shouldBe empty
  }

  it should "start at the site root" in {
    flow.pages.map(_.route) should contain("/")
  }
}
