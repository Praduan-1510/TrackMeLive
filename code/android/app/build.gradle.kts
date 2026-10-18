plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Where debug builds find the Firebase emulators. 10.0.2.2 is the Mac's loopback as seen from the
// Android emulator. For a physical phone, pass the Mac's LAN address: -Ptml.emulatorHost=192.168.1.20
// (and bind the emulators to 0.0.0.0 in code/backend/firebase.json).
val emulatorHost: String = providers.gradleProperty("tml.emulatorHost").getOrElse("10.0.2.2")

android {
    namespace = "live.trackme.app"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "live.trackme.app"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Debug builds talk to the local Firebase emulators (code/backend/run.sh), never a real project.
            buildConfigField("boolean", "USE_FIREBASE_EMULATORS", "true")
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"$emulatorHost\"")
        }
        release {
            isMinifyEnabled = false
            // No real Firebase project exists yet; see data/firebase/FirebaseEnvironment.kt.
            buildConfigField("boolean", "USE_FIREBASE_EMULATORS", "false")
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        named("main") {
            // Shared contracts, compiled in place and never copied (regenerate with `npm --prefix code/shared run build`):
            //  - design tokens, package live.trackme.design, from design-system/tokens.json;
            //  - the Firestore schema, package live.trackme.schema, from code/shared/schema/schema.json.
            kotlin.directories += "../../shared/tokens/generated/kotlin"
            kotlin.directories += "../../shared/schema/generated/kotlin"
        }
    }

    testOptions {
        // Robolectric needs the merged resources for Compose UI tests on the JVM.
        unitTests.isIncludeAndroidResources = true
    }

    lint {
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = false
        lintConfig = file("lint.xml")
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.navigation3.runtime)
    implementation(libs.androidx.navigation3.ui)
    implementation(libs.androidx.lifecycle.viewmodel.navigation3)
    implementation(libs.androidx.datastore.preferences)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.functions)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.libphonenumber)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.androidx.compose.ui.test.junit4)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.androidx.test.core)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
}

tasks.withType<Test>().configureEach {
    // Robolectric downloads its android-all jar from the test JVM; IPv4 avoids the TLS failures some
    // sandboxed shells have on dual-stack sockets (same as gradle.properties does for the daemon).
    systemProperty("java.net.preferIPv4Stack", "true")
    // -Ptml.screenshots=<dir> makes the screenshot tests write PNGs of sign-up states there; skipped otherwise.
    providers.gradleProperty("tml.screenshots").orNull?.let {
        systemProperty("tml.screenshots", it)
        systemProperty("robolectric.pixelCopyRenderMode", "hardware") // real pixels for captureToImage
    }
}
