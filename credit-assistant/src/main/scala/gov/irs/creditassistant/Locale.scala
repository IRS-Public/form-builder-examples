package gov.irs.creditassistant

import io.circe.*
import io.circe.syntax.*
import io.circe.yaml.Printer
import scala.collection.mutable

val generatedFlowContentPath = os.pwd / "src" / "main" / "resources" / "credit-assistant" / "locales" / s"flow_en.yaml"
private def translatedFlowContentPath(languageCode: String) =
  os.pwd / "src" / "main" / "resources" / "credit-assistant" / "locales" / s"flow_$languageCode.yaml"

case class Locale(languageCode: String) {
  // Read the static locale file from disk (not the classpath). Author Mode re-runs the whole build
  // pipeline in-process after writing edited XML to `src/main/resources`, which makes sbt's `~run`
  // watcher rebuild `target/.../classes` underneath us; `Source.fromResource` then transiently fails
  // to find these files. Reading from the source tree (always present) sidesteps that race.
  private val localeFilePath =
    os.pwd / "src" / "main" / "resources" / "credit-assistant" / "locales" / s"${languageCode}.yaml"
  private val mainContent = yaml.scalayaml.Parser.parse(os.read(localeFilePath)) match {
    case Right(parsedData) =>
      parsedData
    case Left(error) =>
      throw new Exception(s"Failed to parse the content at $localeFilePath: ${error.getMessage}", error)
  }
  private val flowContentPath =
    if (languageCode == "en") generatedFlowContentPath else translatedFlowContentPath(languageCode)
  private val flowContentString = os.read(flowContentPath)
  private val flowContent = yaml.scalayaml.Parser.parse(flowContentString) match {
    case Right(parsedData) =>
      parsedData
    case Left(error) =>
      throw new Exception(s"Failed to parse the content at $flowContentPath: ${error.getMessage}", error)
  }

  def get(key: String): Json = {
    // Look at the main content file first, then the automatically-generated one
    val mainContentValue = GetValueFromLocaleJson(key, mainContent)
    mainContentValue match {
      case Some(value) => value
      case None        => GetValueFromLocaleJson(key, flowContent).getOrElse(Json.Null)
    }
  }
}

implicit val anyEncoder: Encoder[Any] = Encoder.instance {
  case m: mutable.LinkedHashMap[_, _] => Json.obj(m.map { case (k, v) => (k.toString, anyEncoder(v)) }.toSeq*)
  case s: String                      => Json.fromString(s)
}

/** Generate the flow_en.yaml locale file.
  *
  * @param translationMap
  *   A populated map of all of the key-value pairs for translations
  */
def generateFlowLocaleFile(translationMap: mutable.LinkedHashMap[String, Any]): Unit = {
  val json = translationMap.asJson
  val yamlString = Printer(dropNullKeys = true, preserveOrder = true).pretty(json)
  val content = s"# DO NOT EDIT, THIS IS A GENERATED FILE\n$yamlString"
  // Skip the write when content is unchanged so an edit that can't affect flow text (e.g. a
  // constant or fact-description save) doesn't touch this file's mtime/git status.
  if (!os.exists(generatedFlowContentPath) || os.read(generatedFlowContentPath) != content) {
    os.write.over(generatedFlowContentPath, content)
    Log.info(s"Generated flow content at ${generatedFlowContentPath}")
  }
}

/** The 7 non-English flow locales, human-translated against `flow_en.yaml`'s key set. */
val translatedFlowLocales: Seq[String] = List("es", "ht", "ko", "ru", "vi", "zh-hans", "zh-hant")

// Marker prefixed onto a stubbed value before serialization, then rewritten into a
// standalone `# TODO: translate` comment above the key in the emitted YAML. Chosen to
// never collide with real translation text.
private val TodoTranslateSentinel = "@@TODO_TRANSLATE@@"
private val TodoTranslateComment = "# TODO: translate"

/** Re-sync every non-English `flow_{lang}.yaml` to the current `flow_en.yaml` key set.
  *
  * Intended to be called in-process by the Author Mode save endpoint (package `gov.irs.creditassistant.authoring`)
  * immediately after [[generateFlowLocaleFile]] has rewritten `flow_en.yaml`, so that `YamlValidatorSpec` / CI stay
  * green after any on-screen-text or option edit. For each of the 7 locales it, using `flow_en.yaml` as the source of
  * truth for the key structure:
  *
  *   - keeps every existing human translation whose key still exists in `flow_en.yaml`, byte-for-byte in text (only
  *     YAML formatting is normalized),
  *   - adds any key present in `flow_en.yaml` but missing from the locale, seeded with the English value and tagged
  *     with a `# TODO: translate` comment, and
  *   - drops any orphaned key that is no longer present in `flow_en.yaml`.
  *
  * Reads the freshly-written `flow_en.yaml` from disk, so callers only need to have regenerated it first. This is
  * deliberately NOT wired into the normal build pipeline ([[regenerate]]): it rewrites human-maintained files and so
  * should only run on an authoring save, never on every dev build.
  */
def syncTranslationLocales(): Unit = {
  yaml.parser.parse(os.read(generatedFlowContentPath)) match {
    case Left(error) =>
      throw new Exception(s"Failed to parse $generatedFlowContentPath for locale sync: ${error.getMessage}", error)
    case Right(englishContent) =>
      translatedFlowLocales.foreach(locale => syncTranslationLocale(locale, englishContent))
  }
}

/** Rewrite a single `flow_{lang}.yaml` so its key set matches `englishContent`. */
private def syncTranslationLocale(locale: String, englishContent: Json): Unit = {
  val localePath = translatedFlowContentPath(locale)
  val existing = yaml.parser.parse(os.read(localePath)) match {
    case Right(parsed) => Some(parsed)
    case Left(error)   =>
      Log.info(s"Could not parse ${localePath} (${error.getMessage}); rebuilding it from flow_en.yaml")
      None
  }

  val merged = mergeLocaleTree(englishContent, existing)

  // splitLines = false keeps each value on a single line (matching the existing
  // hand-written translation files, and keeping the TODO sentinel on the key's line).
  val yamlString = Printer(dropNullKeys = true, preserveOrder = true, splitLines = false).pretty(merged)
  val withTodoComments = yamlString.linesIterator
    .flatMap { line =>
      if (line.contains(TodoTranslateSentinel)) {
        val indent = line.takeWhile(_ == ' ')
        List(s"$indent$TodoTranslateComment", line.replace(TodoTranslateSentinel, ""))
      } else List(line)
    }
    .mkString("\n")

  val header = s"# Auto-synced from flow_en.yaml — do not add/remove keys here.\n" +
    s"# Human translations are preserved; entries marked \"$TodoTranslateComment\" still need translation.\n"
  val content = s"$header$withTodoComments\n"
  // Skip the write when content is unchanged so locales unaffected by the edit that triggered
  // this sync aren't rewritten (and don't show up as touched in git).
  if (!os.exists(localePath) || os.read(localePath) != content) {
    os.write.over(localePath, content)
    Log.info(s"Synced flow locale $locale at ${localePath}")
  }
}

/** Build a locale tree shaped exactly like `english` (the source of truth for keys/order):
  *   - object nodes recurse, iterating English keys only (so orphaned locale keys are dropped),
  *   - leaf nodes keep the existing translated string when present, otherwise fall back to the English value prefixed
  *     with [[TodoTranslateSentinel]] to mark it for translation.
  */
private def mergeLocaleTree(english: Json, existing: Option[Json]): Json =
  english.asObject match {
    case Some(enObj) =>
      val exObj = existing.flatMap(_.asObject)
      Json.fromFields(
        enObj.toList.map { case (key, enChild) =>
          key -> mergeLocaleTree(enChild, exObj.flatMap(_(key)))
        },
      )
    case None =>
      existing match {
        case Some(translated) if translated.isString => translated
        case _ => Json.fromString(TodoTranslateSentinel + english.asString.getOrElse(""))
      }
  }

private def GetValueFromLocaleJson(key: String, content: Json): Option[Json] = {
  val keyParts = key.split('.')
  val cursor = content.hcursor.downFields(keyParts.head, keyParts.tail*)

  cursor.as[String] match {
    case Right(str) => Some(Json.fromString(str))
    case Left(_)    => cursor.focus
  }
}
