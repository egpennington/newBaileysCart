plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.android.lint)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        allWarningsAsErrors.set(true)
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

lint {
    abortOnError = true
    warningsAsErrors = true
    disable += setOf("GradleDependency", "NewerVersionAvailable")
}

dependencies {
    testImplementation(libs.junit)
}
