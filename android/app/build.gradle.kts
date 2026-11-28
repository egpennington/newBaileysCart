plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "com.penningtonlabs.baileyscart"
    compileSdk = libs.versions.compileSdk.get().toInt()

    defaultConfig {
        // NONPRODUCTION PLACEHOLDER. The permanent Play applicationId is an open PL decision.
        applicationId = "com.penningtonlabs.baileyscart.wp00placeholder"
        minSdk = libs.versions.minSdk.get().toInt()
        targetSdk = libs.versions.targetSdk.get().toInt()
        versionCode = 1
        versionName = "0.0.0-wp00"
    }

    buildTypes {
        release {
            // No signing config: WP-00 produces unsigned artifacts only (no production signing material).
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    lint {
        abortOnError = true
        warningsAsErrors = true
        checkDependencies = true
        // Versions are deliberately pinned by the version decision record; "newer version"
        // checks need network access and would make the gate nondeterministic.
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }
}

kotlin {
    compilerOptions {
        allWarningsAsErrors.set(true)
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)

    // BC-S2-LOCAL-PERSIST LP-2 (PL-authorized; LP-0 D-2 amendment): encrypted storage for the
    // debug LOCAL DEMO only. Never implementation/api: release must not contain :core:storage,
    // Room, androidx.sqlite or SQLCipher (NC-98; scripts/check-release-isolation.sh).
    debugImplementation(project(":core:storage"))

    // BC-FAMILY-SYNC-01 Step 2 (PL-approved; Sync Contract Rev 2 section 6): the Firebase Android SDK
    // for the DEBUG family-sharing app, talking only to the local Emulator Suite. debugImplementation
    // only: release must contain no com.google.firebase classes (scripts/check-release-isolation.sh).
    // No firebase-functions SDK: it requires firebase-iid, which calls Google's production
    // Installations service. Callables are invoked over the callable HTTP protocol instead.
    debugImplementation(platform(libs.firebase.bom))
    debugImplementation(libs.firebase.auth)
    debugImplementation(libs.firebase.firestore)
    constraints {
        // Keep the transitive versions resolved and checksummed in the PL-approved fetch session
        // (2026-11-27): without firebase-functions, conflict resolution would otherwise fall back to
        // older okio / kotlin-stdlib-jdk7/8 versions that were never fetched or verified.
        debugImplementation("com.squareup.okio:okio:3.6.0")
        debugImplementation("org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.9.10")
        debugImplementation("org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.9.10")
    }

    testImplementation(libs.junit)
}
