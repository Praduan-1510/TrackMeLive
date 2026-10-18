plugins {
    id("com.android.application")
}

android {
    namespace = "live.trackme.spike.calldetect"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "live.trackme.spike.calldetect"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1-spike"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
