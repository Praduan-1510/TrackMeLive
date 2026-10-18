package live.trackme.app.data.location

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import live.trackme.app.data.sharing.ActiveShare
import live.trackme.app.data.sharing.PreferencesShareStore
import live.trackme.app.data.sharing.StoredShare
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class AndroidLocationPermissionsTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private val activity: Activity = Robolectric.buildActivity(Activity::class.java).setup().get()
    private val fine = Manifest.permission.ACCESS_FINE_LOCATION
    private val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
    private val notifications = "android.permission.POST_NOTIFICATIONS"

    @Before
    fun nothingGranted() {
        // Robolectric grants what the manifest asks for; start from a fresh install instead.
        shadowOf(app).denyPermissions(fine, coarse, notifications)
    }

    private fun permissions(sdk: Int = 34, withActivity: Boolean = true) = AndroidLocationPermissions(
        app,
        currentActivity = { activity.takeIf { withActivity } },
        prefs = app.getSharedPreferences("test_permissions_$sdk", Context.MODE_PRIVATE),
        sdkInt = sdk,
    )

    private fun rationale(permission: String, show: Boolean) {
        shadowOf(app.packageManager).setShouldShowRequestPermissionRationale(permission, show)
    }

    @Test
    fun `nothing asked yet reads as not asked`() {
        val p = permissions()
        assertEquals(PermissionStatus.NotAsked, p.state.value.location)
        assertFalse(p.state.value.preciseLocation)
        assertEquals(PermissionStatus.NotAsked, p.state.value.notifications)
        assertArrayEquals(arrayOf(fine, coarse), p.locationPermissionsToRequest)
        assertEquals(notifications, p.notificationPermissionToRequest)
    }

    @Test
    fun `precise and approximate are told apart`() {
        val p = permissions()
        shadowOf(app).grantPermissions(coarse)
        p.onLocationRequestResult(mapOf(fine to false, coarse to true))
        assertEquals(PermissionStatus.Granted, p.state.value.location)
        assertFalse(p.state.value.preciseLocation)
        shadowOf(app).grantPermissions(fine)
        p.refresh()
        assertTrue(p.state.value.preciseLocation)
    }

    @Test
    fun `a refusal the system will ask about again is Denied, one it won't is DeniedForever`() {
        val p = permissions()
        rationale(fine, true)
        rationale(coarse, true)
        p.onLocationRequestResult(mapOf(fine to false, coarse to false))
        assertEquals(PermissionStatus.Denied, p.state.value.location)
        rationale(fine, false)
        rationale(coarse, false)
        p.onLocationRequestResult(mapOf(fine to false, coarse to false))
        assertEquals(PermissionStatus.DeniedForever, p.state.value.location)
        // It's remembered: Settings is offered until the permission is granted there.
        p.refresh()
        assertEquals(PermissionStatus.DeniedForever, p.state.value.location)
        shadowOf(app).grantPermissions(fine, coarse)
        p.refresh()
        assertEquals(PermissionStatus.Granted, p.state.value.location)
    }

    @Test
    fun `without an Activity a refusal isn't called permanent`() {
        val p = permissions(withActivity = false)
        p.onLocationRequestResult(mapOf(fine to false, coarse to false))
        assertEquals(PermissionStatus.Denied, p.state.value.location)
    }

    @Test
    fun `notifications on Android 13 and up are asked like location`() {
        val p = permissions(sdk = 34)
        rationale(notifications, false)
        p.onNotificationRequestResult(false)
        assertEquals(PermissionStatus.DeniedForever, p.state.value.notifications)
        shadowOf(app).grantPermissions(notifications)
        p.onNotificationRequestResult(true)
        assertEquals(PermissionStatus.Granted, p.state.value.notifications)
    }

    @Test
    fun `below Android 13 there's nothing to ask, unless they're off in Settings`() {
        val p = permissions(sdk = 32)
        assertNull(p.notificationPermissionToRequest)
        assertEquals(PermissionStatus.Granted, p.state.value.notifications)
        shadowOf(app.getSystemService(android.app.NotificationManager::class.java)).setNotificationsEnabled(false)
        p.refresh()
        assertEquals(PermissionStatus.DeniedForever, p.state.value.notifications)
    }

    @Test
    fun `the Settings intents point at this app`() {
        val p = permissions()
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, p.appSettingsIntent().action)
        assertEquals("package:live.trackme.app", p.appSettingsIntent().dataString)
        assertEquals(Settings.ACTION_APP_NOTIFICATION_SETTINGS, p.notificationSettingsIntent().action)
        assertEquals("live.trackme.app", p.notificationSettingsIntent().getStringExtra(Settings.EXTRA_APP_PACKAGE))
        assertEquals(Settings.ACTION_LOCATION_SOURCE_SETTINGS, p.locationServicesIntent().action)
    }
}

@RunWith(RobolectricTestRunner::class)
class PreferencesShareStoreTest {
    private val app = ApplicationProvider.getApplicationContext<Application>()
    private var boot = 7
    private val store = PreferencesShareStore(app.getSharedPreferences("test_share", Context.MODE_PRIVATE)) { boot }
    private val share = ActiveShare("s-1", "https://trackme.live/s/AAAAAAAAAAAAAAAAAAAAAA", "Mom", null, 1_000, 3_601_000)

    @Test
    fun `a share is kept until cleared`() {
        assertNull(store.load())
        store.save(StoredShare("alex", share))
        assertEquals(StoredShare("alex", share), store.load())
        store.save(StoredShare("alex", share.copy(viewerName = null)))
        assertNull(store.load()?.share?.viewerName)
        store.clear()
        assertNull(store.load())
    }

    @Test
    fun `the clock offset is kept only for the boot it was measured in`() {
        assertNull(store.loadClockOffset())
        store.saveClockOffset(123_456)
        assertEquals(123_456L, store.loadClockOffset())
        boot = 8
        assertNull(store.loadClockOffset())
    }

    @Test
    fun `without a boot count nothing is kept`() {
        boot = -1
        store.saveClockOffset(5)
        assertNull(store.loadClockOffset())
    }
}
