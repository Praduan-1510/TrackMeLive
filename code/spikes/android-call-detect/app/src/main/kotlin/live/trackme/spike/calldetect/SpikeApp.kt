package live.trackme.spike.calldetect

import android.app.Application

class SpikeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        SpikeLog.init(this)
        CallMonitor.start(this)
    }
}
