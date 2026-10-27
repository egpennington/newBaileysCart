// Versions are pinned in gradle/libs.versions.toml; rationale in docs/wp00/VERSION_DECISION_RECORD.md.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.lint) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.compose.compiler) apply false
}

// Deterministic resolution: every resolvable configuration is locked (gradle.lockfile per project).
subprojects {
    dependencyLocking {
        lockAllConfigurations()
        lockMode.set(LockMode.STRICT)
    }

    // WP-00 Fix B (PL-authorized): AGP 9.4.0's Android Lint tool pulls in versions with known
    // vulnerabilities (osv-scanner, FORGE run 40447910773). Patched versions apply to the lint
    // tool classpath only; application runtime dependencies are unaffected.
    configurations.matching { it.name == "androidLintTool" }.configureEach {
        resolutionStrategy.eachDependency {
            when ("${requested.group}:${requested.name}") {
                "org.bouncycastle:bcprov-jdk18on",
                "org.bouncycastle:bcpkix-jdk18on",
                "org.bouncycastle:bcutil-jdk18on" -> {
                    useVersion("1.85")
                    because("GHSA-9pwp-9qqc-pr26, GHSA-qp49-qgx5-5m26, GHSA-c3fc-8qff-9hwx, GHSA-wg6q-6289-32hp")
                }
                "org.apache.commons:commons-lang3" -> {
                    useVersion("3.18.0")
                    because("osv-scanner finding against 3.16.0")
                }
                "org.apache.httpcomponents:httpclient" -> {
                    useVersion("4.5.13")
                    because("osv-scanner finding against 4.5.6")
                }
                // WP-00 Fix C (PL-authorized, WP00-MAINT-01): FORGE run 40559437781.
                "com.google.guava:guava" -> {
                    useVersion("33.7.2-jre")
                    because("GHSA-xxph-c9ww-hj94 / CVE-2026-102554 against 33.4.0-jre")
                }
            }
        }
    }
}
