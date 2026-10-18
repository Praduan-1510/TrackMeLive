// Same toolchain as the Track Me Live Android app (code/android): Gradle 9.8.0, AGP 9.4.1 with
// built-in Kotlin, KGP 2.4.20. The KGP line only pins the Kotlin version so this spike reuses the
// app's Gradle cache instead of pulling AGP's bundled default.
buildscript {
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20")
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
}
