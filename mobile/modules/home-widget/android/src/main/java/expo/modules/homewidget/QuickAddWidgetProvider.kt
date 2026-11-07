package expo.modules.homewidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * A small home-screen widget: a headline figure (today's total, or the portfolio's value), and a button that opens the
 * link the app wrote with it (Add expense, or the portfolio). The words and the amount are
 * written by the app (already formatted in the person's currency and language); the widget only shows them.
 * Everything is kept in a private preferences file; nothing is read from the app's database.
 */
class QuickAddWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, build(context))
  }

  companion object {
    const val PREFS = "home_widget"
    const val TITLE = "title"
    const val AMOUNT = "amount"
    const val ADD = "add"
    const val LINK = "link"
    const val DEFAULT_LINK = "expensetracker://expense/new"

    fun build(context: Context): RemoteViews {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val views = RemoteViews(context.packageName, R.layout.quick_add_widget)
      prefs.getString(TITLE, null)?.let { views.setTextViewText(R.id.widget_title, it) }
      views.setTextViewText(R.id.widget_amount, prefs.getString(AMOUNT, "") ?: "")
      prefs.getString(ADD, null)?.let { views.setTextViewText(R.id.widget_add, it) }

      // Opens the app where the app said to, through a link it already answers to: Add expense unless told otherwise.
      val link = prefs.getString(LINK, null) ?: DEFAULT_LINK
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(link)).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      val pending = PendingIntent.getActivity(
        context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      views.setOnClickPendingIntent(R.id.widget_add, pending)
      views.setOnClickPendingIntent(R.id.widget_root, pending)
      return views
    }

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, QuickAddWidgetProvider::class.java))
      for (id in ids) manager.updateAppWidget(id, build(context))
    }
  }
}
