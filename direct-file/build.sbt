ThisBuild / version := "0.1.0-SNAPSHOT"
ThisBuild / scalaVersion := "3.7.2"

// Set default class for "run"
Compile / mainClass := Some("gov.irs.directfile.main")

// Two generated trees under src/main/resources are kept off the classpath:
//
//   node_modules/            lint tooling — eslint, html-validate, and the USWDS distribution that
//                            `make copy-uswds` lifts out of it. 14,638 files.
//   website-static/vendor/   the generated mirrors: taxpert, USWDS, the Fact Graph bundle. 2,683
//                            files, gitignored, with exactly one writer each.
//
// Neither is ever read from the classpath, so copying 17,000 files into `target/classes` and jarring
// them is pure waste. The site generator reads `website-static/` from **disk** — `Website.scala` does
// `os.copy(app.websiteStaticDir, …)` against `FormBuilderApp.resourceRoot`, not a classpath lookup —
// and the Dockerfile serves `out/` from nginx rather than running the jar. Only the *library's* own
// browser assets travel in a jar, and those are form-builder's.
//
// Both clauses of each filter are load-bearing: the filter is applied to each file rather than used
// to prune the directory, so matching the directory's own name alone excludes one entry and keeps
// everything underneath it.
//
// WHAT THIS DOES NOT FIX, contrary to what an earlier version of this comment claimed. `make ci`
// fails here perhaps one run in three with a `FileNotFoundException` or a `ClassNotFoundException`
// naming something under `target/`, and the cause is not a file count: it is that
// `docker-compose.override.yml`'s watch container bind-mounts this directory and runs `sbt ~run`
// inside it, so a containerised build and a host build share one `target/scala-3.7.2/classes`.
// `make copy-uswds` opens with an `rm -rf` of its target, which retriggers that watcher on every
// host build — its own log records `Build triggered by …/uswds-3.13.0/img/material-icons/wash.svg`
// and then the same exception. `make down` (or stopping that one container) before a host build is
// the workaround; giving the container its own target/ is the fix, and belongs in the compose
// files for all four applications rather than here.
//
// `flow_en.yaml` is excluded for an unrelated reason: `regenerate` writes it back into
// src/main/resources on every run, and without this an `sbt ~run` loop retriggers itself forever.
def generatedTree(name: String) =
  new SimpleFileFilter(f => f.getName == name || f.getPath.contains(s"/$name/"))

Compile / unmanagedResources / excludeFilter := (Compile / unmanagedResources / excludeFilter).value ||
  "flow_en.yaml" ||
  generatedTree("node_modules") ||
  generatedTree("vendor")

scalafmtConfig := file(".scalafmt.conf")

lazy val root = (project in file("."))
  .settings(
    name := "direct-file",

    // The scaffold: parser, generators, Thymeleaf engine, node templates, chrome locales.
    // Everything it is built on — thymeleaf, jsoup, circe, os-lib, scala-xml, factgraph — arrives
    // transitively, so this is the only line that ever needs to name a version.
    libraryDependencies += "gov.irs" %% "form-builder" % "0.1.0-SNAPSHOT",

    libraryDependencies += "org.scalatest" %% "scalatest" % "3.2.19" % Test,
    )
