package expo.modules.paymentnotifications

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Hears every notification Android shows and keeps only those of the two apps below. Nothing else is read,
 * stored or passed on: the package is checked before the notification's contents are touched. What is kept
 * waits in a small private queue until the app asks for it, so a payment made while the app was closed is
 * not lost.
 */
class PaymentNotificationService : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    if (sbn.packageName !in ALLOWED_PACKAGES) return
    val extras = sbn.notification.extras ?: return
    val item = JSONObject().apply {
      put("packageName", sbn.packageName)
      put("key", sbn.key)
      put("postTime", sbn.postTime)
      put("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "")
      val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
      put("text", big ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: "")
    }
    synchronized(LOCK) {
      val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val queue = JSONArray(prefs.getString(QUEUE, "[]"))
      queue.put(item)
      // Bounded, so a phone that never opens the app does not grow this forever.
      val kept = JSONArray()
      for (i in maxOf(0, queue.length() - MAX_QUEUED) until queue.length()) kept.put(queue.get(i))
      prefs.edit().putString(QUEUE, kept.toString()).apply()
    }
  }

  companion object {
    val ALLOWED_PACKAGES = setOf("com.mservice.momotransfer", "vn.com.vng.zalopay")
    const val PREFS = "payment_notifications"
    const val QUEUE = "queue"
    const val MAX_QUEUED = 200
    val LOCK = Any()
  }
}
