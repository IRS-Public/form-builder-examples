ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "3.7.2"

// gov.irs::form-builder, and the gov.irs::factgraph that arrives transitively under it, resolve
// from the local Ivy cache at ~/.ivy2/local. Both are published there from checkouts by
// `make bootstrap`, and ~/.ivy2/local is already first in sbt's default resolver chain — which is
// why this build declares no resolvers and no credentials.

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
    libraryDependencies += "gov.irs" %% "form-builder" % "0.1.0-SNAPSHOT",

    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    )
