ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "3.7.2"

// ── Resolving gov.irs::formative from GitHub Packages ─────────────────────────────────────────
//
// formative and fact-graph are no longer built beside this app, so both resolve from a registry.
// GitHub Packages requires authentication even to *read* a public package: set GITHUB_OWNER to the
// org, and GITHUB_ACTOR / GITHUB_TOKEN to a login and a PAT carrying `read:packages`. A CI job on
// GitHub already has the latter two.
val githubOwner = sys.env.getOrElse("GITHUB_OWNER", "IRS-Public")

// Only formative comes from GitHub Packages. gov.irs:factgraph arrives transitively and is
// resolved as a plain library — see formative's build.sbt for how to get it into ~/.ivy2/local.
ThisBuild / resolvers += "formative" at s"https://maven.pkg.github.com/$githubOwner/formative"
ThisBuild / credentials += Credentials(
  "GitHub Package Registry",
  "maven.pkg.github.com",
  sys.env.getOrElse("GITHUB_ACTOR", ""),
  sys.env.getOrElse("GITHUB_TOKEN", ""),
  )

// Set default class for "run"
Compile / mainClass := Some("gov.irs.creditassistant.main")

scalafmtConfig := file(".scalafmt.conf")

// Also re-build on XML changes
// Doesn't work yet
// run / watchTriggers += baseDirectory.value.toGlob / "*.xml"

lazy val root = (project in file("."))
  .settings(
    name := "credit-assistant",

    // The site generator: parser, generators, Thymeleaf engine, node templates, base locales.
    // Everything else this app used to depend on directly — thymeleaf, jsoup, circe, scala-csv,
    // smol, os-lib, scala-xml, factgraph — arrives transitively through it.
    libraryDependencies += "gov.irs" %% "formative" % "0.1.0",

    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    )
