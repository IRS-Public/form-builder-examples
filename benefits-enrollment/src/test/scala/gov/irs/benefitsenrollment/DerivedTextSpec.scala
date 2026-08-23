package gov.irs.benefitsenrollment

import java.util.UUID
import org.scalatest.flatspec.AnyFlatSpec

/** Derived strings that reach a screen as prose rather than as a gate.
  *
  * A wrong number knocks a test over; a wrong string renders and looks almost right, so the ones the flow prints are
  * pinned here.
  */
class DerivedTextSpec extends AnyFlatSpec with TestHelpers {

  "fullName" should "join the two name parts with a space" in {
    val graph = newGraph()
    val id = UUID.randomUUID().toString
    graph.addToCollection("/householdMembers", id)
    graph.set(s"/householdMembers/#$id/firstName", "Jane")
    graph.set(s"/householdMembers/#$id/lastName", "Public")
    graph.save()

    // Paste separates with a space by default, and `sep=" "` does NOT ask for the same thing: every
    // attribute value is trimmed as the fact XML is parsed, so an authored space arrives as "" and
    // this reads "JanePublic". The fact carries no sep for that reason — this pins it.
    assert(graph.get(s"/householdMembers/#$id/fullName").value.contains("Jane Public"))
  }

  it should "stay incomplete until both parts are answered" in {
    val graph = newGraph()
    val id = UUID.randomUUID().toString
    graph.addToCollection("/householdMembers", id)
    graph.set(s"/householdMembers/#$id/firstName", "Jane")
    graph.save()

    assert(graph.get(s"/householdMembers/#$id/fullName").value.isEmpty)
  }
}
