package live.trackme.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import androidx.annotation.VisibleForTesting
import java.lang.ref.WeakReference
import live.trackme.app.di.AppContainer
import live.trackme.app.di.DefaultAppContainer

class TrackMeLiveApplication : Application() {
    private val defaultContainer: AppContainer by lazy { DefaultAppContainer(this, currentActivity = { resumed?.get() }) }
    private var testContainer: AppContainer? = null

    /** The app's dependencies. Built lazily, so Firebase starts when something first needs it. */
    val container: AppContainer get() = testContainer ?: defaultContainer

    /** Tests swap in fakes before any screen asks for a dependency. */
    @VisibleForTesting
    fun useContainer(container: AppContainer) {
        testContainer = container
    }

    // The resumed Activity, for the few SDK calls that need one (phone sign-in's reCAPTCHA fallback).
    private var resumed: WeakReference<Activity>? = null

    override fun onCreate() {
        super.onCreate()
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                resumed = WeakReference(activity)
            }

            override fun onActivityPaused(activity: Activity) {
                if (resumed?.get() === activity) resumed = null
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }
}
