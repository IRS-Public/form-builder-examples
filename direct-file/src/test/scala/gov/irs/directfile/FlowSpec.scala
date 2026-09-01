package gov.irs.directfile

import gov.irs.formbuilder.FormBuilder
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers

/** The flow parses, and the shape the transpiler promised it emits is the shape it emitted.
  *
  * The first assertion is the one worth having on day one anywhere: `parseFlow` validates each `path=` against the fact
  * dictionary and throws on one that does not exist, so a typo fails the build rather than reaching the browser as a
  * question that silently never settles. The rest are particular to this application, and they are here because every
  * page in it is generated — nobody reviews 138 pages by reading them, so the invariants the codemod is supposed to
  * hold have to be asserted rather than assumed.
  *
  * The cookiecutter's third starter assertion, that some page sits at route `/`, was deleted rather than adapted.
  * Direct File's flow has no root screen — it begins at `/you-and-your-family/about-you/about-you-intro` — and it no
  * longer needs one: form-builder writes a redirect at the base path for any locale whose flow claims no root page. An
  * assertion that can only ever be red has stopped being a gate.
  */
class FlowSpec extends AnyFlatSpec with Matchers {

  private lazy val flow = FormBuilder.parseFlow(app)

  /** The five Direct File categories, as `fact-explorer.app.json`'s `pagePrefixes` and the workspace nav both name
    * them. A sixth appearing here means one of those two lists is now silently incomplete.
    */
  private val categories =
    Set("you-and-your-family", "income", "credits-and-deductions", "your-taxes", "complete")

  private def segments(route: String): List[String] =
    route.split("/").toList.filter(_.nonEmpty)

  "the flow" should "parse every module named in index.xml, with every fact path resolving" in {
    flow.pages should not be empty
  }

  it should "give every page a unique route" in {
    // The transpiler fully qualifies a route with its category and subcategory to keep Direct File's SubSubcategory
    // names apart — `care-providers` occurs under both `income/dependent-care` and `credits-and-deductions/credits`.
    // Where that is not enough it is required to suffix and to say so rather than overwrite, and this is what would
    // catch it having overwritten instead.
    val routes = flow.pages.map(_.route)
    routes.diff(routes.distinct) shouldBe empty
  }

  it should "route every page as /category/subcategory/subsubcategory" in {
    // The topic-page collapse, stated as an invariant: one page per Direct File SubSubcategory, at its fully
    // qualified route. Three segments is what `pagePrefixes`, the nav taxonomy and the Browse All grouping all key
    // off, so a page that lost one would drop out of each of them without any of them erroring.
    val malformed = flow.pages.map(_.route).filterNot(segments(_).length == 3)
    malformed shouldBe empty
  }

  it should "put every page under one of the five categories" in {
    val strays = flow.pages.map(_.route).filterNot(route => categories.contains(segments(route).head))
    strays shouldBe empty
  }

  it should "stamp every page with the module it came from" in {
    // `module` is set by FormBuilder.resolveModule as it splices `<module src>` in, and it is the last point at which
    // a page's source file is known. Browse All groups by it, so a page without one is a page that lands ungrouped.
    val unstamped = flow.pages.filter(_.module.isEmpty).map(_.route)
    unstamped shouldBe empty
  }

  it should "keep each page's route in step with its module file" in {
    // One flow module per Direct File subcategory, named `{category}-{subcategory}.xml`. Asserting the two agree is
    // what makes the previous two assertions checks on the flow rather than on the file it happens to sit in: a page
    // emitted into the wrong module keeps a well-formed route and still passes everything above.
    val mismatched = flow.pages.collect {
      case page if page.module.exists(_ != segments(page.route).take(2).mkString("-")) =>
        s"${page.route} in ${page.module.get}.xml"
    }
    mismatched shouldBe empty
  }
}
