package gov.irs.creditassistant.authoring

import gov.irs.factgraph.FactDictionary
import io.circe.parser
import org.scalatest.funspec.AnyFunSpec
import org.scalatest.matchers.should.Matchers
import scala.util.Try
import scala.xml.NodeBuffer

/** Regression guard for the Author Mode "<Subtract> must have at least one <Subtrahends>" report.
  *
  * Symptom: after emptying a `<Subtrahends>` slot to swap its operand and re-adding a valid one, the error stuck and
  * Save stayed disabled. This proves the cause was *not* serialization or backend validation — the editor's JSON for a
  * Subtract whose subtrahend was re-typed (Int → Dollar) both serializes to a well-formed, non-empty `<Subtrahends>`
  * and builds cleanly against the real `FactDictionary`. The stale error was a client-side validate race, fixed in
  * author-mode.js by ignoring superseded validate responses.
  */
class SubtractSubtrahendSwapSpec extends AnyFunSpec with Matchers {

  private val factsDir = os.pwd / "src" / "main" / "resources" / "credit-assistant" / "facts"
  private def sortedFactFiles() = os.list(factsDir).filter(p => os.isFile(p) && p.ext == "xml").sortBy(_.last)

  // Exactly what the editor sends after removing <Int>1</Int> and adding a <Dollar>5000</Dollar>.
  private val treeJson =
    """
    { "tag": "Subtract", "attrs": [], "text": null, "children": [
        { "tag": "Minuend", "attrs": [], "text": null, "children": [
          { "tag": "Dependency", "attrs": [["path","/taxYear"]], "text": null, "children": [] } ]},
        { "tag": "Subtrahends", "attrs": [], "text": null, "children": [
          { "tag": "Dollar", "attrs": [], "text": "5000", "children": [] } ]} ]}
    """

  /** Merge every fact file with constants.xml's /lastTaxYear Derived replaced by `subtractXml`, then build. */
  private def buildWithPatchedLastTaxYear(subtractXml: String): Try[FactDictionary] = Try {
    val buffer = new NodeBuffer()
    for (file <- sortedFactFiles()) {
      var content = os.read(file)
      if (file.last == "constants.xml") {
        val re = "(?s)(<Fact\\s+path=\"/lastTaxYear\">.*?<Derived>)(.*?)(</Derived>)".r
        content = re.replaceFirstIn(content, "$1" + java.util.regex.Matcher.quoteReplacement(subtractXml) + "$3")
      }
      buffer ++= (xml.XML.loadString(content) \ "Facts" \ "_")
    }
    FactDictionary.fromXml(<FactDictionaryModule><Facts>{buffer}</Facts></FactDictionaryModule>)
  }

  describe("a Subtract whose subtrahend was re-typed in the editor") {
    it("serializes to a non-empty <Subtrahends>") {
      val json = parser.parse(treeJson).toOption.get
      val rendered = DerivedXml.render(DerivedXml.fromJson(json)).toString
      rendered shouldBe
        "<Subtract><Minuend><Dependency path=\"/taxYear\"/></Minuend>" +
        "<Subtrahends><Dollar>5000</Dollar></Subtrahends></Subtract>"
    }

    it("builds cleanly against the real FactDictionary (no fact-graph error)") {
      val rendered = DerivedXml.render(DerivedXml.fromJson(parser.parse(treeJson).toOption.get)).toString
      buildWithPatchedLastTaxYear(rendered).isSuccess shouldBe true
    }
  }
}
