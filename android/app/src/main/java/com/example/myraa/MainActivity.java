package com.example.myraa;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    public static final int SERVER_PORT = 3000;
    private WebView webView;
    public AudioManager audioManager;
    public Vibrator vibrator;
    public CameraManager cameraManager;
    public String cameraId = null;
    public Handler mainHandler;
    private ServerSocket serverSocket;
    private ExecutorService threadPool;
    private volatile boolean isRunning = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        mainHandler = new Handler(Looper.getMainLooper());
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        threadPool = Executors.newCachedThreadPool();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                cameraManager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
                if (cameraManager != null) {
                    String[] ids = cameraManager.getCameraIdList();
                    if (ids != null && ids.length > 0) cameraId = ids[0];
                }
            } catch (Exception ignored) {}
        }

        String[] permissions = new String[]{
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(permissions, 101);
            }
        }

        startEmbeddedServer();

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        AndroidBridge bridge = new AndroidBridge(this);
        webView.addJavascriptInterface(bridge, "Android");
        webView.addJavascriptInterface(bridge, "PhoneController");

        webView.setWebChromeClient(new CustomChromeClient());
        webView.setWebViewClient(new CustomViewClient(getAssets()));

        setContentView(webView);
        webView.loadUrl("http://127.0.0.1:" + SERVER_PORT + "/index.html");
    }

    private void startEmbeddedServer() {
        threadPool.execute(new ServerAcceptLoop(this));
    }

    static class ServerAcceptLoop implements Runnable {
        private MainActivity activity;
        public ServerAcceptLoop(MainActivity a) { this.activity = a; }

        @Override
        public void run() {
            try {
                activity.serverSocket = new ServerSocket(SERVER_PORT);
                while (activity.isRunning && !activity.serverSocket.isClosed()) {
                    Socket client = activity.serverSocket.accept();
                    activity.threadPool.execute(new ClientHandler(activity, client));
                }
            } catch (Exception ignored) {}
        }
    }

    static class ClientHandler implements Runnable {
        private MainActivity activity;
        private Socket socket;

        public ClientHandler(MainActivity a, Socket s) {
            this.activity = a;
            this.socket = s;
        }

        @Override
        public void run() {
            try {
                InputStream in = socket.getInputStream();
                OutputStream out = socket.getOutputStream();

                byte[] buffer = new byte[8192];
                int read = in.read(buffer);
                if (read <= 0) {
                    socket.close();
                    return;
                }

                String requestHeader = new String(buffer, 0, read, StandardCharsets.UTF_8);
                String[] lines = requestHeader.split("\r?\n");
                if (lines.length == 0) {
                    socket.close();
                    return;
                }

                String firstLine = lines[0];
                String[] parts = firstLine.split(" ");
                if (parts.length < 2) {
                    socket.close();
                    return;
                }

                String method = parts[0];
                String path = parts[1];
                if (path.contains("?")) path = path.substring(0, path.indexOf("?"));

                boolean isWs = false;
                String wsKey = "";
                for (String line : lines) {
                    if (line.toLowerCase().startsWith("upgrade:") && line.toLowerCase().contains("websocket")) {
                        isWs = true;
                    }
                    if (line.toLowerCase().startsWith("sec-websocket-key:")) {
                        wsKey = line.substring(line.indexOf(":") + 1).trim();
                    }
                }

                if (isWs && wsKey.length() > 0) {
                    handleWebSocketHandshake(in, out, wsKey);
                    return;
                }

                if (path.startsWith("/api/status")) {
                    String json = "{\"status\":\"ok\",\"platform\":\"android\",\"version\":\"1.0.0\",\"device\":\"" + Build.MODEL + "\"}";
                    sendHttpResponse(out, "application/json", json.getBytes(StandardCharsets.UTF_8));
                    socket.close();
                    return;
                }

                if (path.startsWith("/memories")) {
                    File memFile = new File(activity.getFilesDir(), "memories.json");
                    if (method.equals("POST")) {
                        int bodyStart = requestHeader.indexOf("\r\n\r\n");
                        if (bodyStart != -1) {
                            String body = requestHeader.substring(bodyStart + 4);
                            FileOutputStream fos = new FileOutputStream(memFile);
                            fos.write(body.getBytes(StandardCharsets.UTF_8));
                            fos.close();
                        }
                        sendHttpResponse(out, "application/json", "{\"success\":true}".getBytes(StandardCharsets.UTF_8));
                    } else {
                        byte[] data;
                        if (memFile.exists()) {
                            FileInputStream fis = new FileInputStream(memFile);
                            ByteArrayOutputStream baos = new ByteArrayOutputStream();
                            byte[] b = new byte[1024];
                            int r;
                            while ((r = fis.read(b)) != -1) baos.write(b, 0, r);
                            fis.close();
                            data = baos.toByteArray();
                        } else {
                            data = "{\"memories\":[],\"topics\":[]}".getBytes(StandardCharsets.UTF_8);
                        }
                        sendHttpResponse(out, "application/json", data);
                    }
                    socket.close();
                    return;
                }

                String assetPath = path.equals("/") ? "index.html" : (path.startsWith("/") ? path.substring(1) : path);
                try {
                    InputStream assetIn = activity.getAssets().open(assetPath);
                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                    byte[] b = new byte[4096];
                    int r;
                    while ((r = assetIn.read(b)) != -1) baos.write(b, 0, r);
                    assetIn.close();

                    String mime = getMimeType(assetPath);
                    sendHttpResponse(out, mime, baos.toByteArray());
                } catch (Exception e) {
                    String notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n";
                    out.write(notFound.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                socket.close();
            } catch (Exception ignored) {
                try { socket.close(); } catch (Exception ignored2) {}
            }
        }

        private void sendHttpResponse(OutputStream out, String mime, byte[] body) throws Exception {
            String headers = "HTTP/1.1 200 OK\r\n" +
                    "Content-Type: " + mime + "\r\n" +
                    "Content-Length: " + body.length + "\r\n" +
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                    "Access-Control-Allow-Headers: *\r\n" +
                    "Connection: close\r\n\r\n";
            out.write(headers.getBytes(StandardCharsets.UTF_8));
            out.write(body);
            out.flush();
        }

        private String getMimeType(String path) {
            if (path.endsWith(".html")) return "text/html";
            if (path.endsWith(".js") || path.endsWith(".mjs")) return "application/javascript";
            if (path.endsWith(".css")) return "text/css";
            if (path.endsWith(".png")) return "image/png";
            if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
            if (path.endsWith(".svg")) return "image/svg+xml";
            if (path.endsWith(".ico")) return "image/x-icon";
            if (path.endsWith(".json")) return "application/json";
            if (path.endsWith(".vrm") || path.endsWith(".glb")) return "model/gltf-binary";
            if (path.endsWith(".woff2")) return "font/woff2";
            if (path.endsWith(".woff")) return "font/woff";
            if (path.endsWith(".ttf")) return "font/ttf";
            return "application/octet-stream";
        }

        private void handleWebSocketHandshake(InputStream in, OutputStream out, String key) {
            try {
                String acceptKey = Base64.encodeToString(
                        MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.UTF_8)),
                        Base64.NO_WRAP
                );

                String response = "HTTP/1.1 101 Switching Protocols\r\n" +
                        "Upgrade: websocket\r\n" +
                        "Connection: Upgrade\r\n" +
                        "Sec-WebSocket-Accept: " + acceptKey + "\r\n\r\n";
                out.write(response.getBytes(StandardCharsets.UTF_8));
                out.flush();

                while (activity.isRunning && !socket.isClosed()) {
                    int b1 = in.read();
                    if (b1 == -1) break;
                    int b2 = in.read();
                    if (b2 == -1) break;

                    int opcode = b1 & 0x0F;
                    if (opcode == 8) break;

                    boolean masked = (b2 & 0x80) != 0;
                    long length = b2 & 0x7F;

                    if (length == 126) {
                        length = ((in.read() & 0xFF) << 8) | (in.read() & 0xFF);
                    } else if (length == 127) {
                        length = 0;
                        for (int i = 0; i < 8; i++) length = (length << 8) | (in.read() & 0xFF);
                    }

                    byte[] mask = new byte[4];
                    if (masked) {
                        for (int i = 0; i < 4; i++) mask[i] = (byte) in.read();
                    }

                    byte[] payload = new byte[(int) length];
                    int totalRead = 0;
                    while (totalRead < length) {
                        int r = in.read(payload, totalRead, (int) length - totalRead);
                        if (r == -1) break;
                        totalRead += r;
                    }

                    if (masked) {
                        for (int i = 0; i < payload.length; i++) {
                            payload[i] = (byte) (payload[i] ^ mask[i % 4]);
                        }
                    }

                    if (opcode == 1) {
                        String text = new String(payload, StandardCharsets.UTF_8);
                        handleWebSocketMessage(out, text);
                    } else if (opcode == 9) {
                        sendWsFrame(out, 10, payload);
                    }
                }
            } catch (Exception ignored) {}
            try { socket.close(); } catch (Exception ignored2) {}
        }

        private void handleWebSocketMessage(OutputStream out, String text) {
            try {
                if (text.contains("openApp") || text.contains("open")) {
                    activity.mainHandler.post(new OpenAppRunner(activity, "youtube"));
                }
                String reply = "{\"type\":\"text\",\"text\":\"MYRAA Android Engine Active\"}";
                sendWsFrame(out, 1, reply.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {}
        }

        private void sendWsFrame(OutputStream out, int opcode, byte[] data) throws Exception {
            out.write(0x80 | (opcode & 0x0F));
            if (data.length <= 125) {
                out.write(data.length);
            } else if (data.length <= 65535) {
                out.write(126);
                out.write((data.length >> 8) & 0xFF);
                out.write(data.length & 0xFF);
            } else {
                out.write(127);
                for (int i = 7; i >= 0; i--) {
                    out.write((int) ((data.length >> (i * 8)) & 0xFF));
                }
            }
            out.write(data);
            out.flush();
        }
    }

    static class CustomChromeClient extends WebChromeClient {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            if (request != null) request.grant(request.getResources());
        }
    }

    static class CustomViewClient extends WebViewClient {
        private AssetManager assetManager;
        public CustomViewClient(AssetManager am) { this.assetManager = am; }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String path = uri.getPath();
            if (path == null || path.equals("/") || path.length() == 0) path = "index.html";
            if (path.startsWith("/")) path = path.substring(1);

            try {
                InputStream is = assetManager.open(path);
                String mime = "text/html";
                if (path.endsWith(".js") || path.endsWith(".mjs")) mime = "application/javascript";
                else if (path.endsWith(".css")) mime = "text/css";
                else if (path.endsWith(".png")) mime = "image/png";
                else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) mime = "image/jpeg";
                else if (path.endsWith(".svg")) mime = "image/svg+xml";
                else if (path.endsWith(".ico")) mime = "image/x-icon";
                else if (path.endsWith(".json")) mime = "application/json";
                else if (path.endsWith(".vrm") || path.endsWith(".glb")) mime = "model/gltf-binary";
                else if (path.endsWith(".woff2")) mime = "font/woff2";
                else if (path.endsWith(".woff")) mime = "font/woff";
                else if (path.endsWith(".ttf")) mime = "font/ttf";

                Map<String, String> responseHeaders = new HashMap<String, String>();
                responseHeaders.put("Access-Control-Allow-Origin", "*");
                responseHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                responseHeaders.put("Access-Control-Allow-Headers", "*");
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", responseHeaders, is);
            } catch (Exception e) {
                return super.shouldInterceptRequest(view, request);
            }
        }
    }

    public static class AndroidBridge {
        private MainActivity activity;
        public AndroidBridge(MainActivity act) { this.activity = act; }

        @JavascriptInterface
        public String getPlatform() { return "android"; }

        @JavascriptInterface
        public void showToast(final String message) {
            activity.mainHandler.post(new ToastRunner(activity, message));
        }

        @JavascriptInterface
        public void openApp(final String appNameOrPkg) {
            if (appNameOrPkg != null && appNameOrPkg.length() > 0) {
                activity.mainHandler.post(new OpenAppRunner(activity, appNameOrPkg));
            }
        }

        @JavascriptInterface
        public void openSettings(final String type) {
            activity.mainHandler.post(new SettingsRunner(activity, type));
        }

        @JavascriptInterface
        public void setVolume(int percent) {
            if (activity.audioManager == null) return;
            try {
                int max = activity.audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int target = (int) (max * (Math.max(0, Math.min(100, percent)) / 100.0f));
                activity.audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, target, AudioManager.FLAG_SHOW_UI);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void volumeUp() {
            if (activity.audioManager == null) return;
            try {
                activity.audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void volumeDown() {
            if (activity.audioManager == null) return;
            try {
                activity.audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void toggleMute() {
            if (activity.audioManager == null) return;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    activity.audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI);
                }
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void setBrightness(final int percent) {
            activity.mainHandler.post(new BrightnessRunner(activity, percent));
        }

        @JavascriptInterface
        public void vibrate(int milliseconds) {
            if (activity.vibrator != null) {
                try {
                    activity.vibrator.vibrate(Math.max(10, Math.min(5000, milliseconds)));
                } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public void toggleFlashlight(boolean enable) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && activity.cameraManager != null && activity.cameraId != null) {
                try {
                    activity.cameraManager.setTorchMode(activity.cameraId, enable);
                } catch (Exception ignored) {}
            }
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            if (url != null && url.length() > 0) {
                activity.mainHandler.post(new UrlRunner(activity, url));
            }
        }

        @JavascriptInterface
        public void dialPhone(final String number) {
            if (number != null && number.length() > 0) {
                activity.mainHandler.post(new DialRunner(activity, number));
            }
        }

        @JavascriptInterface
        public void sendSms(final String number, final String body) {
            activity.mainHandler.post(new SmsRunner(activity, number, body));
        }

        @JavascriptInterface
        public void copyToClipboard(final String text) {
            activity.mainHandler.post(new ClipboardRunner(activity, text));
        }

        @JavascriptInterface
        public String getDeviceInfo() {
            try {
                IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
                Intent batteryStatus = activity.registerReceiver(null, ifilter);
                int level = batteryStatus != null ? batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) : -1;
                int scale = batteryStatus != null ? batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1) : -1;
                int batteryPct = (int) ((level / (float) scale) * 100);

                int curVol = activity.audioManager != null ? activity.audioManager.getStreamVolume(AudioManager.STREAM_MUSIC) : 0;
                int maxVol = activity.audioManager != null ? activity.audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC) : 1;
                int volPct = (int) ((curVol / (float) maxVol) * 100);

                return "{\"battery\":" + batteryPct + ",\"volume\":" + volPct + ",\"model\":\"" + Build.MODEL + "\",\"android\":\"" + Build.VERSION.RELEASE + "\"}";
            } catch (Exception e) {
                return "{\"battery\":100,\"volume\":50}";
            }
        }
    }

    static class ToastRunner implements Runnable {
        private MainActivity activity;
        private String message;
        public ToastRunner(MainActivity a, String m) { this.activity = a; this.message = m; }
        public void run() { Toast.makeText(activity, message != null ? message : "", Toast.LENGTH_SHORT).show(); }
    }

    static class OpenAppRunner implements Runnable {
        private MainActivity activity;
        private String app;
        public OpenAppRunner(MainActivity a, String s) { this.activity = a; this.app = s; }
        public void run() {
            try {
                String pkg = resolvePackageName(app);
                Intent intent = activity.getPackageManager().getLaunchIntentForPackage(pkg);
                if (intent != null) {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                } else {
                    Intent marketIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("market://search?q=" + app));
                    marketIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(marketIntent);
                }
            } catch (Exception e) {
                Toast.makeText(activity, "Could not open " + app, Toast.LENGTH_SHORT).show();
            }
        }
    }

    static class SettingsRunner implements Runnable {
        private MainActivity activity;
        private String type;
        public SettingsRunner(MainActivity a, String t) { this.activity = a; this.type = t; }
        public void run() {
            try {
                Intent intent;
                String t = (type != null ? type.toLowerCase() : "");
                if (t.contains("wifi")) intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                else if (t.contains("blue")) intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                else if (t.contains("sound") || t.contains("volume")) intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                else if (t.contains("display") || t.contains("bright")) intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                else if (t.contains("app")) intent = new Intent(Settings.ACTION_APPLICATION_SETTINGS);
                else intent = new Intent(Settings.ACTION_SETTINGS);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e) {
                try {
                    Intent intent = new Intent(Settings.ACTION_SETTINGS);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(intent);
                } catch (Exception ignored) {}
            }
        }
    }

    static class BrightnessRunner implements Runnable {
        private MainActivity activity;
        private int percent;
        public BrightnessRunner(MainActivity a, int p) { this.activity = a; this.percent = p; }
        public void run() {
            try {
                WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
                lp.screenBrightness = Math.max(0.01f, Math.min(1.0f, percent / 100.0f));
                activity.getWindow().setAttributes(lp);
            } catch (Exception ignored) {}
        }
    }

    static class UrlRunner implements Runnable {
        private MainActivity activity;
        private String url;
        public UrlRunner(MainActivity a, String u) { this.activity = a; this.url = u; }
        public void run() {
            try {
                String target = url;
                if (!target.startsWith("http://") && !target.startsWith("https://")) target = "https://" + target;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(target));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    static class DialRunner implements Runnable {
        private MainActivity activity;
        private String number;
        public DialRunner(MainActivity a, String n) { this.activity = a; this.number = n; }
        public void run() {
            try {
                Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number.trim()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    static class SmsRunner implements Runnable {
        private MainActivity activity;
        private String number;
        private String body;
        public SmsRunner(MainActivity a, String n, String b) { this.activity = a; this.number = n; this.body = b; }
        public void run() {
            try {
                Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + (number != null ? number.trim() : "")));
                if (body != null) intent.putExtra("sms_body", body);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception ignored) {}
        }
    }

    static class ClipboardRunner implements Runnable {
        private MainActivity activity;
        private String text;
        public ClipboardRunner(MainActivity a, String t) { this.activity = a; this.text = t; }
        public void run() {
            try {
                ClipboardManager cm = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm != null) {
                    cm.setPrimaryClip(ClipData.newPlainText("MYRAA", text != null ? text : ""));
                    Toast.makeText(activity, "Copied to clipboard", Toast.LENGTH_SHORT).show();
                }
            } catch (Exception ignored) {}
        }
    }

    public static String resolvePackageName(String name) {
        String lower = name.toLowerCase().trim();
        if (lower.contains("youtube")) return "com.google.android.youtube";
        if (lower.contains("whatsapp")) return "com.whatsapp";
        if (lower.contains("chrome") || lower.contains("browser")) return "com.android.chrome";
        if (lower.contains("camera")) return "com.google.android.GoogleCamera";
        if (lower.contains("spotify")) return "com.spotify.music";
        if (lower.contains("instagram")) return "com.instagram.android";
        if (lower.contains("maps")) return "com.google.android.apps.maps";
        if (lower.contains("gmail") || lower.contains("mail")) return "com.google.android.gm";
        if (lower.contains("play store") || lower.contains("store")) return "com.android.vending";
        if (lower.contains("calculator") || lower.contains("calc")) return "com.google.android.calculator";
        if (lower.contains("clock") || lower.contains("alarm")) return "com.google.android.deskclock";
        if (lower.contains("settings")) return "com.android.settings";
        if (lower.contains("telegram")) return "org.telegram.messenger";
        if (lower.contains("twitter") || lower.contains("x")) return "com.twitter.android";
        if (lower.contains("photos") || lower.contains("gallery")) return "com.google.android.apps.photos";
        return name;
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        isRunning = false;
        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
        }
        if (threadPool != null) {
            threadPool.shutdownNow();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}