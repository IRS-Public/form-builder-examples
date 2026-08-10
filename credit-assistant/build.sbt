ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "3.7.2"

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
    libraryDependencies += "gov.irs" %% "formative" % "0.1.0-SNAPSHOT",

    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    )
