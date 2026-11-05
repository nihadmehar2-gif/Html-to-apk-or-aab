# WebView host app — minification disabled by default, rules kept for reference.
-keep class com.html2apk.studio.wv.** { *; }
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
