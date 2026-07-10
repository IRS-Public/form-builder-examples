package gov.irs.creditassistant.authoring

import gov.irs.factgraph.FactDictionary
import org.scalatest.funspec.AnyFunSpec
import org.scalatest.matchers.should.Matchers
import scala.xml.{ Elem, Node, NodeBuffer }

/** The T16 acceptance gate for the generic Derived serializer.
  *
  * Every computation subtree in the real fact dictionaries (~484 facts) is put through `parse → render → parse` and
  * must come back structurally identical, and a `FactDictionary` rebuilt entirely from the re-rendered subtrees must
  * still load. Together these prove the serializer is a lossless, fact-graph-valid inverse — the correctness foundation
  * the Derived editor (T18) and the create/derived wizard (T17) rely on.
  */
class DerivedXmlRoundTripSpec extends AnyFunSpec with Matchers {

  private val factsDir = os.pwd / "src" / "main" / "resources" / "credit-assistant" / "facts"

  private def factFiles(): Seq[os.Path] =
    os.list(factsDir).filter(p => os.isFile(p) && p.ext == "xml").sortBy(_.last)

  /** The elements whose element children are computation nodes we must round-trip. */
  private val ComputationHosts = Set("Derived", "Placeholder", "Condition", "Default")

  /** Every computation-node element in a fact: the children of Derived/Placeholder, and the Condition/Default children
    * inside Override.
    */
  private def computationNodes(fact: Node): Seq[Elem] =
    (fact \ "_").collect { case e: Elem => e }.flatMap {
      case e if e.label == "Derived" || e.label == "Placeholder" =>
        e.child.collect { case c: Elem => c }
      case e if e.label == "Override" =>
        (e \ "_")
          .collect { case c: Elem if ComputationHosts.contains(c.label) => c }
          .flatMap(_.child.collect { case cc: Elem => cc })
      case _ => Seq.empty
    }

  describe("DerivedXml") {
    it("round-trips every computation subtree in the fact dictionaries structurally") {
      var checked = 0
      for {
        file <- factFiles()
        fact <- xml.XML.loadString(os.read(file)) \\ "Fact"
        node <- computationNodes(fact)
      } {
        val once = DerivedXml.parse(node)
        val twice = DerivedXml.parse(DerivedXml.render(once))
        withClue(s"in ${file.last}, fact ${fact \@ "path"}, node <${node.label}>: ") {
          twice shouldBe once
        }
        checked += 1
      }
      info(s"round-tripped $checked computation subtrees")
      checked should be > 400
    }

    it("produces a fact dictionary that still loads after every subtree is re-rendered") {
      // Rebuild each fact, replacing every computation subtree with render(parse(...)).
      def rerenderHost(host: Elem): Elem =
        host.copy(child = host.child.map {
          case c: Elem => DerivedXml.render(DerivedXml.parse(c))
          case other   => other
        })

      def rerenderFact(fact: Elem): Elem =
        fact.copy(child = fact.child.map {
          case e: Elem if e.label == "Derived" || e.label == "Placeholder" => rerenderHost(e)
          case e: Elem if e.label == "Override"                            =>
            e.copy(child = e.child.map {
              case c: Elem if ComputationHosts.contains(c.label) => rerenderHost(c)
              case other                                         => other
            })
          case other => other
        })

      def dictionaryFrom(transform: Elem => Elem): FactDictionary = {
        val buffer = new NodeBuffer()
        for (file <- factFiles()) {
          val root = xml.XML.loadString(os.read(file))
          val facts = (root \ "Facts" \ "_").map {
            case f: Elem if f.label == "Fact" => transform(f)
            case other                        => other
          }
          buffer ++= facts
        }
        FactDictionary.fromXml(<FactDictionaryModule><Facts>{buffer}</Facts></FactDictionaryModule>)
      }

      val baseline = dictionaryFrom(identity)
      val rerendered = dictionaryFrom(rerenderFact)

      rerendered.getPaths().size shouldBe baseline.getPaths().size
    }
  }
}
