package expo.modules.homewidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HomeWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidget")

    // Remember the words and the amount, and redraw any widget already on the home screen.
    Function("update") { title: String, amount: String, add: String ->
      val context = appContext.reactContext ?: return@Function Unit
      context.getSharedPreferences(QuickAddWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
        .putString(QuickAddWidgetProvider.TITLE, title)
        .putString(QuickAddWidgetProvider.AMOUNT, amount)
        .putString(QuickAddWidgetProvider.ADD, add)
        .apply()
      QuickAddWidgetProvider.refresh(context)
    }

    // Forget the amount (signing out): a widget must not keep showing someone's spending.
    Function("clear") {
      val context = appContext.reactContext ?: return@Function Unit
      context.getSharedPreferences(QuickAddWidgetProvider.PREFS, Context.MODE_PRIVATE).edit().clear().apply()
      QuickAddWidgetProvider.refresh(context)
    }

    // Ask the launcher to offer adding the widget; false where it cannot (older Android, or a launcher without it).
    Function("requestPin") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val manager = context.getSystemService(AppWidgetManager::class.java)
      if (manager == null || !manager.isRequestPinAppWidgetSupported) return@Function false
      manager.requestPinAppWidget(ComponentName(context, QuickAddWidgetProvider::class.java), null, null)
    }
  }
}
