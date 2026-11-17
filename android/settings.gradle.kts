pluginManagement {
    repositories {
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
