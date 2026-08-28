ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "3.7.2"

// Set default class for "run"
Compile / mainClass := Some("gov.irs.directfile.main")

// Prevent additional compilation when the generated locale file is created. `regenerate` writes
// flow_en.yaml back into src/main/resources on every run, and without this an `sbt ~run` loop
// re-triggers itself forever.
Compile / unmanagedResources / excludeFilter := (Compile / unmanagedResources / excludeFilter).value ||
  "flow_en.yaml" ||
  // `src/main/resources/direct-file/node_modules` is lint tooling — eslint, html-validate, and the
  // USWDS distribution that `make copy-uswds` lifts out of it into `website-static/vendor/`. None of
  // it belongs on the classpath, and every file of it was being copied into `target/classes` and
  // then jarred. Past ~16,000 files that copy and the packaging step disagree about what is there,
  // and the build dies with a FileNotFoundException naming some file deep inside a dependency
  // (`es-abstract/2020/Canonicalize.js`, `@eslint/config-array/...`) — intermittently, so a retry
  // often "fixes" it. Pruning the directory removes the failure and most of the build's I/O.
  // Every app in this repository has the same node_modules under resources; the two with the
  // largest trees are the two that flake.
  //
  // Both clauses are load-bearing: the filter is applied to each file rather than used to prune the
  // directory, so matching the directory's own name alone excludes one entry and keeps all 15,831
  // underneath it.
  new SimpleFileFilter(f => f.getName == "node_modules" || f.getPath.contains("/node_modules/"))

scalafmtConfig := file(".scalafmt.conf")

lazy val root = (project in file("."))
  .settings(
    name := "direct-file-form-builder",

    // The scaffold: parser, generators, Thymeleaf engine, node templates, chrome locales.
    // Everything it is built on — thymeleaf, jsoup, circe, os-lib, scala-xml, factgraph — arrives
    // transitively, so this is the only line that ever needs to name a version.
    libraryDependencies += "gov.irs" %% "form-builder" % "0.1.0-SNAPSHOT",

    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    )
