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
}
