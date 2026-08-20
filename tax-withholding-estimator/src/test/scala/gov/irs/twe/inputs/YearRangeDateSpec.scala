package gov.irs.twe.inputs

import gov.irs.factgraph.FactDictionary
import gov.irs.formbuilder.generators.Website
import gov.irs.formbuilder.parser.Flow
import gov.irs.formbuilder.FormBuilderApp
import gov.irs.twe.app
import org.jsoup.Jsoup
import org.scalatest.funspec.AnyFunSpec
import org.scalatest.matchers.should.Matchers.*
import scala.jdk.CollectionConverters.ListHasAsScala
import scala.xml.Elem

/** The registered input type, end to end.
  *
  * This is the proof that [[gov.irs.formbuilder.FormBuilderApp.inputTypes]] is a real extension point and not just a
  * hook that compiles: nothing in the scaffold knows what `previous-years` means, and the year select below only exists
  * because this app registered a parser for `date` and shipped a template to match. The scaffold's own date input
  * renders a plain text field, which is what the first case asserts is *no longer* what TWE gets.
  */
class YearRangeDateSpec extends AnyFunSpec {
  private given FormBuilderApp = app

  private val dateDictionaryConfig = <FactDictionaryModule>
    <Facts>
      <Fact path="/taxYear">
        <Description>The tax year of the return.</Description>
        <TaxYear>2026</TaxYear>
        <Derived>
          <Int>2026</Int>
        </Derived>
      </Fact>

      <Fact path="/eventDate">
        <Name>Event Date</Name>
        <Writable>
          <Day/>
        </Writable>
      </Fact>
    </Facts>
  </FactDictionaryModule>

  private def render(inputElement: Elem) = {
    val formConfig = <FlowConfig>
      <page route="/" title="Date Input Test Form">
        <section>
          <fg-set path="/eventDate">
            <question>When did this happen?</question>
            {inputElement}
          </fg-set>
        </section>
      </page>
    </FlowConfig>

    val factDictionary = FactDictionary.fromXml(dateDictionaryConfig)
    val flow = Flow.fromXmlConfig(formConfig, factDictionary, app)
    val site = Website.generate(flow, dateDictionaryConfig, Map())
    Jsoup.parse(site.pages.head.content)
  }

  private def yearOptionValues(document: org.jsoup.nodes.Document) =
    document.select("select[name=/eventDate-year] option").eachAttr("value").asScala

  describe("date input year rendering") {
    it("pins the year to the tax year when neither attribute is set") {
      val yearInput = render(<input type="date"/>).select("input[name=/eventDate-year]")

      yearInput.attr("type") shouldBe "text"
      yearInput.hasAttr("readonly") shouldBe true
      yearInput.attr("value") shouldBe "2026"
    }

    it("renders the requested number of previous tax years when previous-years is set") {
      yearOptionValues(render(<input type="date" previous-years="2"/>)) should
        contain theSameElementsInOrderAs Seq("2024", "2025", "2026")
    }

    it("renders the requested number of future tax years when future-years is set") {
      yearOptionValues(render(<input type="date" future-years="2"/>)) should
        contain theSameElementsInOrderAs Seq("2026", "2027", "2028")
    }

    it("renders previous and future tax years together when both attributes are set") {
      yearOptionValues(render(<input type="date" previous-years="1" future-years="1"/>)) should
        contain theSameElementsInOrderAs Seq("2025", "2026", "2027")
    }
  }
}
