package gov.irs.benefitsenrollment

import gov.irs.factgraph.Graph
import gov.irs.formbuilder.loadFactDictionary

/** Writes the scenario corpus to `src/main/resources/benefits-enrollment/scenarios/`.
  *
  * sbt "Test/runMain gov.irs.benefitsenrollment.GenerateScenarios"
  *
  * The output is committed — `--scenarioMode` copies the directory into the built site and lists it in the Scenario
  * modal, so the files are the product, not a build artifact. Re-run this after editing `Scenarios`, then `sbt test`;
  * `ScenariosSpec` fails if the two have drifted.
  */
object GenerateScenarios:

  /** Keys sorted and pretty-printed. The persister writes a `Map`, whose iteration order is not stable across runs, so
    * without this a regenerated corpus is a diff of every line even when nothing changed.
    */
  private def canonical(json: String): String =
    val sorted = ujson.Obj.from(ujson.read(json).obj.toSeq.sortBy(_._1))
    ujson.write(sorted, indent = 2) + "\n"

  def buildJson(scenario: Scenarios.Scenario): String =
    val graph = Graph(loadFactDictionary(app).factDictionary)
    scenario.fill(graph)
    val (saved, violations) = graph.save()
    require(saved, s"${scenario.filename}: the graph refused to save")
    require(violations.isEmpty, s"${scenario.filename}: limit violations ${violations.map(_.limitName).mkString(", ")}")
    canonical(graph.persister.toJson())

  def main(args: Array[String]): Unit =
    val dir = app.scenariosDir
    os.makeDir.all(dir)
    for scenario <- Scenarios.all do
      os.write.over(dir / scenario.filename, buildJson(scenario))
      println(f"${scenario.filename}%-52s ${scenario.label}")
    println(s"\n${Scenarios.all.size} scenarios -> $dir")
