package expo.modules.paymentnotifications

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaymentNotificationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaymentNotifications")

    // Whether the person has switched on Notification access for this app in Android settings.
    Function("isEnabled") {
      val context = appContext.reactContext ?: return@Function false
      val flat = Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      val mine = ComponentName(context, PaymentNotificationService::class.java).flattenToString()
      flat?.split(":")?.contains(mine) ?: false
    }

    Function("openSettings") {
      val context = appContext.reactContext ?: return@Function Unit
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    // The optional heads-up when a payment is spotted: on or off, and its words in the app's language.
    Function("setAlerts") { enabled: Boolean, title: String, body: String ->
      val context = appContext.reactContext ?: return@Function Unit
      context.getSharedPreferences(PaymentNotificationService.PREFS, Context.MODE_PRIVATE).edit()
        .putBoolean(PaymentNotificationService.ALERTS, enabled)
        .putString(PaymentNotificationService.ALERT_TITLE, title)
        .putString(PaymentNotificationService.ALERT_BODY, body)
        .apply()
    }

    Function("alertsEnabled") {
      val context = appContext.reactContext ?: return@Function false
      context.getSharedPreferences(PaymentNotificationService.PREFS, Context.MODE_PRIVATE)
        .getBoolean(PaymentNotificationService.ALERTS, false)
    }

    // What has arrived since the last call, as JSON, and forgets it.
    Function("drain") {
      val context = appContext.reactContext ?: return@Function "[]"
      synchronized(PaymentNotificationService.LOCK) {
        val prefs = context.getSharedPreferences(PaymentNotificationService.PREFS, Context.MODE_PRIVATE)
        val queue = prefs.getString(PaymentNotificationService.QUEUE, "[]") ?: "[]"
        prefs.edit().putString(PaymentNotificationService.QUEUE, "[]").apply()
        queue
      }
    }
  }
}
