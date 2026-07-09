package gov.irs.creditassistant

import gov.irs.creditassistant.build.Flags
import gov.irs.creditassistant.exceptions.InvalidFormConfig
import gov.irs.creditassistant.generators.Website
import gov.irs.creditassistant.parser.Flow
import gov.irs.creditassistant.parser.PageSplitter
import scala.util.matching.Regex
import scala.util.Try
import scala.xml.Elem
import scala.xml.NodeBuffer

// The flow files on disk. We read flow XML from here (not via the classpath) so `regenerate()`
// always reflects the latest saved state — Author Mode patches these files on disk and re-invokes
// `regenerate()` in-process, whereas `Source.fromResource` would read the stale copy sbt cached under
// target/.../classes at build time.
val FlowResourceDir = os.pwd / "src" / "main" / "resources" / "credit-assistant" / "flow"
val flagRegex = new Regex("""--(\w*)""")

@main def main(args: String*): Unit = {
  val flags = Map.from(
    args.map {
      case flagRegex(name) => (name, true)
      case flag            =>
        throw new Error(s"Unable to recognize parameter: $flag")
    },
  )

  // Parse the flow + fact dictionary from resources and (re)generate flow_en.yaml
  // and the static site under ./out. Extracted so the Author Mode save endpoint can
  // re-run the exact same pipeline in-process after writing edited XML to disk.
  val outDir = regenerate(flags)

  // Start the embedded Author Mode authoring backend only under --authorMode (via `make dev-author`).
  // It binds its own host/port (`-Dsmol.author.host`/`-Dsmol.author.port`, default localhost/3004),
  // separate from smol, and is never started in production. It re-invokes `regenerate(flags)`
  // in-process after each save.
  //
  // The host defaults to "localhost" (loopback-only — this API can patch source XML and commit to
  // git, so it must not be reachable off-box). The docker-compose dev overlay overrides it to
  // "0.0.0.0" for the `credit-assistant-watch` container: binding to loopback *inside* a container
  // is invisible to Docker's port-publishing NAT (same reason that container doesn't pass `--serve`
  // for smol — see docker-compose.override.yml), so it must listen on all interfaces and rely on
  // the host-side port mapping (`127.0.0.1:3004:3004`) for the loopback-only guarantee instead.
  if flags.contains(Flags.authorMode) then {
    val authorHost = sys.props.get("smol.author.host").getOrElse("localhost")
    val authorPort = sys.props
      .get("smol.author.port")
      .flatMap(s => Try(s.toInt).toOption)
      .getOrElse(3004)
    try authoring.AuthoringServer.start(authorHost, authorPort, flags)
    catch {
      case _: java.net.BindException =>
        println(s"\u001b[33m\u001b[1m\u26a0\u001b[0m Author Mode API already running on port ${authorPort}")
    }
  }

  if !flags.contains(Flags.serve) then return // Only start smol if 'serve' flag is set

  val host = "localhost"
  val port = sys.props
    .get("smol.port")
    .flatMap(s => Try(s.toInt).toOption)
    .getOrElse(3002)
  val config = smol.Config(outDir.toString(), host, port, logEnabled = true)

  // Start server in-process, but do not block.
  // If it’s already running from a previous ~run cycle, starting again will throw BindException - ignore and continue.
  try
    val server = smol.Smol.start(config)
    sys.addShutdownHook(server.stop(0))
    val url = s"http://${host}:${port}/app/eitc"
    val green = "\u001b[32m"
    val cyan = "\u001b[36m"
    val bold = "\u001b[1m"
    val reset = "\u001b[0m"
    println(s"\n${green}${bold}✓${reset} ${bold}Credit Assistant Server${reset} ${cyan}ready${reset}")
    println(s"  ${bold}Local:${reset}   ${cyan}${url}${reset}\n")
  catch
    case _: java.net.BindException =>
      val url = s"http://${host}:${port}/app/eitc"
      val yellow = "\u001b[33m"
      val cyan = "\u001b[36m"
      val bold = "\u001b[1m"
      val reset = "\u001b[0m"
      println(s"\n${yellow}${bold}⚠${reset} ${bold}Server${reset} ${yellow}already running${reset}")
      println(s"  ${bold}Local:${reset}   ${cyan}${url}${reset}\n")
}

/** Re-parse the Flow + Fact Dictionary XML from resources, regenerate the auto-generated `flow_en.yaml`, render the
  * static site with [[Website.generate]], and save it to `./out/app/eitc`.
  *
  * This is the whole read-side build pipeline, extracted from `main` so it can be invoked both at startup and
  * in-process afterward (e.g. by the Author Mode save endpoint, once it has written edited XML back to the resources on
  * disk). It re-reads all inputs from disk on every call, so callers only need to have persisted their edits first.
  *
  * @return
  *   the `./out` directory the site was saved under (the root the `smol` static server serves).
  */
def regenerate(flags: Map[String, Boolean]): os.Path = {
  // Get flow root
  val flowFile = os.read(FlowResourceDir / "index.xml")
  val flowConfig = xml.XML.loadString(flowFile)
  val children = flowConfig \\ "FlowConfig" \ "_"

  // Resolve modules
  // Note that modules can only appear in the top level
  val resolvedChildren = children.map(child =>
    child.label match {
      case "module" => resolveModule(child)
      case _        => child
    },
  )

  val resolvedConfig = <FlowConfig>{resolvedChildren}</FlowConfig>

  val caFactDictionary = loadCreditAssistantFactDictionary()
  val parsedFlow = Flow.fromXmlConfig(resolvedConfig, caFactDictionary.factDictionary)
  val flow =
    if (flags.contains(Flags.singleQuestionPerScreen))
      Flow(PageSplitter.split(parsedFlow.pages), parsedFlow.translationContext)
    else parsedFlow
  generateFlowLocaleFile(flow.translationContext.translationMap)
  val site = Website.generate(flow, caFactDictionary.xml, flags)

  // Delete out/ directory and add files to it
  val outDir = os.pwd / "out"
  site.save(outDir / "app/eitc")
  outDir
}

def resolveModule(node: xml.Node): xml.NodeSeq = {
  val src = node \@ "src"
  // Remove the ./ prefix in the src attribute
  // We support this so that people can use local file path resolution in their text editors
  val resolvedSrc = src.replaceAll("^\\./", "")
  val moduleFile = os.read(FlowResourceDir / resolvedSrc)

  val flowConfigModule = xml.XML.loadString(moduleFile)
  if (flowConfigModule.label != "FlowConfig") {
    throw InvalidFormConfig(s"Module file $src does not have a top-level FlowConfig")
  }

  flowConfigModule \ "_"
}
