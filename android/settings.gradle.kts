pluginManagement {
    repositories {
        // BC-GRADLE-VERIFY-01: Kotlin plugin markers resolve only from Maven Central, whose
        // POMs match verification-metadata.xml. The Plugin Portal serves different marker POMs.
        exclusiveContent {
            forRepository { mavenCentral() }
            filter {
                includeGroup("org.jetbrains.kotlin.jvm")
                includeGroup("org.jetbrains.kotlin.plugin.compose")
            }
        }
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "newBaileysCart"

include(":app")
include(":core:model")
// BC-S2-LOCAL-PERSIST LP-1: encrypted local storage (promoted from the BC-UI-S2b spike). :app does not depend on it.
include(":core:storage")
