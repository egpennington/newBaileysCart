// :core:storage (BC-S2-LOCAL-PERSIST LP-1, PL-authorized; LP-0 decisions D-2..D-5, D-7, D-11/E-11a).
// Promoted unchanged in behavior from the BC-UI-S2b storage spike. Fictional data and synthetic accounts only.
// :app does NOT depend on this module in LP-1 (LP-2 adds debugImplementation only, separately authorized).
// Strict flags are inherited unchanged: allWarningsAsErrors, lint warningsAsErrors, STRICT lockfile
// (root subprojects block), SHA-256 dependency verification (gradle/verification-metadata.xml).
plugins {
    id("com.android.library") // same AGP 9.4.0 artifact already on the build classpath (built-in Kotlin)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
}

android {
    namespace = "com.penningtonlabs.baileyscart.core.storage"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        minSdk = libs.versions.minSdk.get().toInt()
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = false
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkDependencies = true
        // Same deliberate exclusions as :app (pinned versions; network-dependent checks).
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

kotlin {
    compilerOptions {
        allWarningsAsErrors.set(true)
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

room {
    schemaDirectory("$projectDir/schemas")
}

// Carried from the BC-UI-S2b spike (PL-authorized 2026-11-08; D-2 LP-0): CVE-2026-102554 / GHSA-xxph-c9ww-hj94.
// androidx.room:room-compiler:2.8.5 brings com.google.guava:guava:33.2.1-jre onto the KSP annotation-processor
// classpaths (build-time only). Pin ONLY guava, ONLY on this module's KSP processor classpaths, to the version
// the PL already approved for androidLintTool in WP-00 Fix C. No other dependency or module is affected.
configurations.matching {
    (it.name.startsWith("ksp") && it.name.endsWith("ProcessorClasspath")) ||
        (it.name.startsWith("_agp_internal_") && it.name.endsWith("_kspClasspath"))
}.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "com.google.guava" && requested.name == "guava") {
            useVersion("33.7.2-jre")
            because("GHSA-xxph-c9ww-hj94 / CVE-2026-102554 against 33.2.1-jre (via room-compiler 2.8.5); :core:storage KSP only")
        }
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(libs.room.runtime)
    ksp(libs.room.compiler)
    implementation(libs.sqlcipher.android)
    implementation(libs.androidx.sqlite)

    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.junit)
}
