package gov.irs.creditassistant.build

object Flags {
  val serve = "serve"
  val allScreens = "allScreens"
  val auditMode = "auditMode"
  val singleQuestionPerScreen = "singleQuestionPerScreen"
  val scenarioMode = "scenarioMode"

  // Master switch for the prompt / AI features in the audit panel (the "Explain &
  // Analyze" chat tab and its rail button). Default OFF — enabled with `--aiMode` —
  // so the still-maturing chat backend stays hidden until it is robust. Mirrors the
  // Formative Studio `VITE_AI_MODE` flag (see formative-studio/src/config/featureFlags.js).
  val aiMode = "aiMode"
}
