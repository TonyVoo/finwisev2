package expo.modules.paymentnotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.text.Normalizer
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
    maybeAlert(item.optString("title") + " " + item.optString("text"), sbn.key)
  }

  /**
   * An optional heads-up (off unless the person turned it on in the app): "possible payment detected". Deliberately
   * a rough check, not the app's parser - an amount in dong plus words that say money moved, and none of the words
   * of codes and promotions. The app does the real reading when it opens; this only says "have a look".
   */
  private fun maybeAlert(raw: String, key: String) {
    val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(ALERTS, false) || !looksLikePayment(raw)) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Payment detection", NotificationManager.IMPORTANCE_DEFAULT)
      )
    }
    val open = Intent(Intent.ACTION_VIEW, Uri.parse("expensetracker://settings/payment-detection")).apply {
      setPackage(applicationContext.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    val pending = PendingIntent.getActivity(
      applicationContext, 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(applicationContext, CHANNEL)
    } else {
      @Suppress("DEPRECATION") Notification.Builder(applicationContext)
    }
    val notification = builder
      .setSmallIcon(android.R.drawable.stat_notify_more)
      .setContentTitle(prefs.getString(ALERT_TITLE, "Possible payment detected"))
      .setContentText(prefs.getString(ALERT_BODY, "Tap to review it."))
      .setContentIntent(pending)
      .setAutoCancel(true)
      .build()
    // The same payment notified twice replaces itself.
    manager.notify(key.hashCode(), notification)
  }

  companion object {
    const val ALERTS = "alerts"
    const val ALERT_TITLE = "alert_title"
    const val ALERT_BODY = "alert_body"
    const val CHANNEL = "payment_detection"
    private val AMOUNT = Regex("""\d[\d.,]*\s?(d|dong|vnd|₫)(?![a-z0-9])""")
    private val MONEY_MOVED = Regex("thanh toan|chuyen|nhan|giao dich|hoan tien|da gui|nap tien|da tra")
    private val NOISE = Regex("otp|ma xac thuc|ma xac nhan|uu dai|khuyen mai|voucher|nhap ma|giam gia|giam \\d|den han|can thanh toan|sap het han|het han")

    fun looksLikePayment(raw: String): Boolean {
      val plain = Normalizer.normalize(raw.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "").replace('đ', 'd')
      return AMOUNT.containsMatchIn(plain) && MONEY_MOVED.containsMatchIn(plain) && !NOISE.containsMatchIn(plain)
    }

    val ALLOWED_PACKAGES = setOf("com.mservice.momotransfer", "vn.com.vng.zalopay")
    const val PREFS = "payment_notifications"
    const val QUEUE = "queue"
    const val MAX_QUEUED = 200
    val LOCK = Any()
  }
}
