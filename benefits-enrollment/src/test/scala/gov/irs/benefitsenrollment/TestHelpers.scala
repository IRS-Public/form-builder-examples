package gov.irs.benefitsenrollment

import gov.irs.factgraph.types.MultiEnum
import gov.irs.factgraph.Graph
import gov.irs.formbuilder.loadFactDictionary
import java.util.UUID
import org.scalatest.matchers.should.Matchers

/** Shared fact-graph setup. Every rule in this application is a property of the fact dictionary, so the tests build a
  * graph and read derived facts — no flow, no browser, no HTML.
  */
trait TestHelpers extends Matchers:

  def newGraph(): Graph = Graph(loadFactDictionary(app).factDictionary)

  def booleanAt(graph: Graph, path: String): Option[Boolean] =
    graph.get(path).value.map(_.asInstanceOf[Boolean])

  def intAt(graph: Graph, path: String): Option[Int] =
    graph.get(path).value.map(v => BigDecimal(v.toString).toInt)

  /** A gate that is off is either incomplete or explicitly false, but never complete-true. */
  def assertGateOff(graph: Graph, path: String): Unit =
    if booleanAt(graph, path).contains(true) then
      throw AssertionError(s"""expected "$path" not to be complete true (got ${booleanAt(graph, path)})""")

  def chooseBenefits(graph: Graph, values: String*): Unit =
    graph.set("/benefitChoices", MultiEnum(values.toSet, "/benefitOptions"))

  /** Adds one person and returns their collection id. The flags are the four membership questions that replace the
    * prototype's separate applicant keys and its two hand-entered size integers.
    */
  def addPerson(
      graph: Graph,
      isSelf: Boolean = false,
      isApplicant: Boolean = false,
      inTaxHousehold: Boolean = true,
      sharesMeals: Boolean = true,
  ): String =
    val id = UUID.randomUUID().toString
    graph.addToCollection("/householdMembers", id)
    val p = s"/householdMembers/#$id"
    graph.set(s"$p/isSelf", isSelf)
    graph.set(s"$p/isApplicant", isApplicant)
    graph.set(s"$p/inTaxHousehold", inTaxHousehold)
    graph.set(s"$p/sharesMeals", sharesMeals)
    id
