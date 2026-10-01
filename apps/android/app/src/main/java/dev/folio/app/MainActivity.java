package dev.folio.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

public final class MainActivity extends Activity {
  private WebView webView;
  private ValueCallback<Uri[]> fileCallback;
  private final ExecutorService imageExecutor = Executors.newFixedThreadPool(2);
  private final ConcurrentHashMap<String, HttpURLConnection> connections =
      new ConcurrentHashMap<>();
  private View fullscreenView;
  private WebChromeClient.CustomViewCallback fullscreenCallback;
  private FrameLayout frame;
  private static final String ORIGIN = "https://appassets.androidplatform.net";

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    webView = new WebView(this);
    frame = new FrameLayout(this);
    frame.addView(webView, new FrameLayout.LayoutParams(-1, -1));
    setContentView(frame);
    frame.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars =
                insets.getInsets(android.view.WindowInsets.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
          }
          return insets;
        });
    webView.addJavascriptInterface(new ImageBridge(), "FolioImages");
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setMixedContentMode(
        BuildConfig.DEBUG
            ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    webView.setWebViewClient(
        new WebViewClient() {
          @Override
          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!uri.toString().startsWith(ORIGIN + "/assets/")) return null;
            String file = uri.getLastPathSegment();
            if (!Arrays.asList(
                    "index.html", "app.js", "app.css", "icon.svg", "manifest.webmanifest")
                .contains(file))
              return new WebResourceResponse(
                  "text/plain",
                  "UTF-8",
                  404,
                  "Not Found",
                  Collections.emptyMap(),
                  new ByteArrayInputStream(new byte[0]));
            try {
              String type =
                  file.endsWith("js")
                      ? "text/javascript"
                      : file.endsWith("css")
                          ? "text/css"
                          : file.endsWith("svg")
                              ? "image/svg+xml"
                              : file.endsWith("webmanifest")
                                  ? "application/manifest+json"
                                  : "text/html";
              Map<String, String> headers = new HashMap<>();
              headers.put("X-Content-Type-Options", "nosniff");
              headers.put(
                  "Content-Security-Policy",
                  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src"
                      + " 'self' https: http: blob: data:; connect-src https: http:; object-src"
                      + " 'none'; frame-src 'none'; base-uri 'none'");
              return new WebResourceResponse(
                  type, "UTF-8", 200, "OK", headers, getAssets().open(file));
            } catch (IOException error) {
              return new WebResourceResponse(
                  "text/plain",
                  "UTF-8",
                  404,
                  "Not Found",
                  Collections.emptyMap(),
                  new ByteArrayInputStream(new byte[0]));
            }
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri.toString().startsWith(ORIGIN + "/assets/")) return false;
            if (request.isForMainFrame()
                && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())))
              startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
          }
        });
    webView.setWebChromeClient(
        new WebChromeClient() {
          @Override
          public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
              callback.onCustomViewHidden();
              return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            webView.setVisibility(View.GONE);
            frame.addView(view, new FrameLayout.LayoutParams(-1, -1));
          }

          @Override
          public void onHideCustomView() {
            if (fullscreenView == null) return;
            frame.removeView(fullscreenView);
            fullscreenView = null;
            webView.setVisibility(View.VISIBLE);
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
          }

          @Override
          public boolean onShowFileChooser(
              WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
              startActivityForResult(intent, 10);
              return true;
            } catch (Exception error) {
              fileCallback = null;
              callback.onReceiveValue(null);
              return true;
            }
          }
        });
    webView.loadUrl(ORIGIN + "/assets/index.html");
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request != 10 || fileCallback == null) return;
    Uri[] uris = null;
    if (result == RESULT_OK && data != null) {
      ClipData clip = data.getClipData();
      if (clip != null) {
        uris = new Uri[clip.getItemCount()];
        for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
      } else if (data.getData() != null) uris = new Uri[] {data.getData()};
    }
    fileCallback.onReceiveValue(uris);
    fileCallback = null;
  }

  @Override
  public void onBackPressed() {
    if (fullscreenView != null) {
      webView.evaluateJavascript("document.exitFullscreen()", null);
      return;
    }
    webView.evaluateJavascript(
        "document.querySelector('#reader').hidden && !document.querySelector('#detail').open &&"
            + " !document.querySelector('#tutorial').open &&"
            + " document.querySelector('#nav-library').hasAttribute('aria-current')",
        value -> {
          if ("true".equals(value)) MainActivity.super.onBackPressed();
          else
            webView.evaluateJavascript(
                "document.querySelector('#tutorial').open ?"
                    + " document.querySelector('#tutorial').close() :"
                    + " document.querySelector('#reader').hidden ?"
                    + " document.querySelector('#detail').open ?"
                    + " document.querySelector('#detail').close() :"
                    + " document.querySelector('#nav-library').click() :"
                    + " document.querySelector('#reader-back').click()",
                null);
        });
  }

  public final class ImageBridge {
    @JavascriptInterface
    public void cancel(String id) {
      HttpURLConnection connection = connections.remove(id);
      if (connection != null) connection.disconnect();
    }

    @JavascriptInterface
    public void fetch(String id, String address) {
      if (id == null || id.length() > 80 || address == null || address.length() > 8192) return;
      imageExecutor.execute(
          () -> {
            HttpURLConnection connection = null;
            try {
              URL url = new URL(address);
              if (!"https".equals(url.getProtocol())
                  && !(BuildConfig.DEBUG && "http".equals(url.getProtocol())))
                throw new IOException("Use an HTTPS page image");
              if (url.getUserInfo() != null)
                throw new IOException("Credentials in page URLs are not supported");
              connection = (HttpURLConnection) url.openConnection();
              connections.put(id, connection);
              connection.setConnectTimeout(15000);
              connection.setReadTimeout(20000);
              connection.setInstanceFollowRedirects(false);
              if (connection.getResponseCode() != 200)
                throw new IOException("Page image returned HTTP " + connection.getResponseCode());
              String type = connection.getContentType();
              if (type == null) throw new IOException("Missing image type");
              type = type.split(";")[0].trim().toLowerCase(Locale.ROOT);
              if (!Arrays.asList("image/png", "image/jpeg", "image/webp", "image/gif", "image/avif")
                  .contains(type)) throw new IOException("Unsupported page image type");
              if (connection.getContentLengthLong() > 25 * 1024 * 1024)
                throw new IOException("Page image is too large");
              ByteArrayOutputStream output = new ByteArrayOutputStream();
              try (InputStream input = connection.getInputStream()) {
                byte[] chunk = new byte[16384];
                int count;
                while ((count = input.read(chunk)) != -1) {
                  if (output.size() + count > 25 * 1024 * 1024)
                    throw new IOException("Page image is too large");
                  output.write(chunk, 0, count);
                }
              }
              JSONObject data = new JSONObject();
              data.put("type", type);
              data.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
              final String json = data.toString();
              runOnUiThread(
                  () -> {
                    if (!isFinishing())
                      webView.evaluateJavascript(
                          "window.folioImageResult(" + JSONObject.quote(id) + "," + json + ",null)",
                          null);
                  });
            } catch (Exception error) {
              final String message =
                  error.getMessage() == null ? "Could not download page image" : error.getMessage();
              runOnUiThread(
                  () -> {
                    if (!isFinishing())
                      webView.evaluateJavascript(
                          "window.folioImageResult("
                              + JSONObject.quote(id)
                              + ",null,"
                              + JSONObject.quote(message)
                              + ")",
                          null);
                  });
            } finally {
              connections.remove(id);
              if (connection != null) connection.disconnect();
            }
          });
    }
  }

  @Override
  protected void onDestroy() {
    imageExecutor.shutdownNow();
    for (HttpURLConnection connection : connections.values()) connection.disconnect();
    if (fileCallback != null) fileCallback.onReceiveValue(null);
    webView.destroy();
    super.onDestroy();
  }
}
