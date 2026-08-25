"""
MYRAA Desktop Control Agent v2.0
High-performance, DPI-aware local background agent for Windows automation.
Listens on http://127.0.0.1:8765
"""

import os
import sys
import json
import base64
import ctypes
import io
import time
import subprocess
import winreg
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

# Enable Per-Monitor DPI awareness
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

APPDATA_DIR = os.environ.get("APPDATA") or str(Path.home() / ".config")
MYRAA_DATA_DIR = Path(os.environ.get("MYRAA_DATA_DIR") or (Path(APPDATA_DIR) / "myraa"))
MYRAA_DATA_DIR.mkdir(parents=True, exist_ok=True)
(MYRAA_DATA_DIR / "logs").mkdir(parents=True, exist_ok=True)
(MYRAA_DATA_DIR / "screenshots").mkdir(parents=True, exist_ok=True)

LOG_FILE = MYRAA_DATA_DIR / "logs" / "agent.log"

def log_message(level: str, msg: str):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [{level}] myraa.desktop: {msg}\n"
    sys.stdout.write(line)
    sys.stdout.flush()
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass

def resolve_path(p: str) -> Path:
    if not p:
        return MYRAA_DATA_DIR
    clean = str(p).strip()
    lower = clean.lower()
    user_home = Path.home()
    if lower in ("desktop", "/desktop", "\\desktop"):
        return user_home / "Desktop"
    if lower.startswith("desktop/") or lower.startswith("desktop\\"):
        return user_home / "Desktop" / clean[8:]
    if lower in ("documents", "docs"):
        return user_home / "Documents"
    if lower.startswith("documents/") or lower.startswith("documents\\"):
        return user_home / "Documents" / clean[10:]
    if lower == "downloads":
        return user_home / "Downloads"
    if lower.startswith("downloads/") or lower.startswith("downloads\\"):
        return user_home / "Downloads" / clean[10:]
    
    path_obj = Path(clean)
    if path_obj.is_absolute():
        return path_obj
    return MYRAA_DATA_DIR / path_obj

def capture_screen_image() -> bytes:
    """Captures the primary monitor using native Win32 GDI BitBlt with full DPI awareness."""
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    
    width = user32.GetSystemMetrics(0)
    height = user32.GetSystemMetrics(1)
    
    hdesktop = user32.GetDesktopWindow()
    hdc_screen = user32.GetDC(hdesktop)
    hdc_mem = gdi32.CreateCompatibleDC(hdc_screen)
    hbitmap = gdi32.CreateCompatibleBitmap(hdc_screen, width, height)
    
    gdi32.SelectObject(hdc_mem, hbitmap)
    gdi32.BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, 0, 0, 0x00CC0020 | 0x40000000) # SRCCOPY | CAPTUREBLT
    
    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ('biSize', ctypes.c_uint32),
            ('biWidth', ctypes.c_int32),
            ('biHeight', ctypes.c_int32),
            ('biPlanes', ctypes.c_uint16),
            ('biBitCount', ctypes.c_uint16),
            ('biCompression', ctypes.c_uint32),
            ('biSizeImage', ctypes.c_uint32),
            ('biXPelsPerMeter', ctypes.c_int32),
            ('biYPelsPerMeter', ctypes.c_int32),
            ('biClrUsed', ctypes.c_uint32),
            ('biClrImportant', ctypes.c_uint32)
        ]
        
    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0
    
    buf = ctypes.create_string_buffer(width * height * 4)
    gdi32.GetDIBits(hdc_mem, hbitmap, 0, height, buf, ctypes.byref(bmi), 0)
    
    gdi32.DeleteObject(hbitmap)
    gdi32.DeleteDC(hdc_mem)
    user32.ReleaseDC(hdesktop, hdc_screen)
    
    if HAS_PIL:
        img = Image.frombuffer('RGBA', (width, height), buf, 'raw', 'BGRA', 0, 1)
        out = io.BytesIO()
        img.save(out, format='PNG')
        return out.getvalue()
    
    # Fallback to clicker.exe screenshot if PIL not imported
    clicker = MYRAA_DATA_DIR.parent / "resources" / "agent" / "clicker.exe"
    if clicker.exists():
        p = subprocess.run([str(clicker), "screenshot", "--base64"], capture_output=True, text=True)
        try:
            return base64.b64decode(json.loads(p.stdout.strip())["data"])
        except Exception:
            pass
    raise RuntimeError("Screenshot capture failed.")

def perform_windows_ocr(img_bytes: bytes) -> str:
    """Performs OCR on Windows 10/11 using Windows.Media.Ocr via PowerShell."""
    tmp_path = MYRAA_DATA_DIR / "screenshots" / "temp_ocr.png"
    with open(tmp_path, "wb") as f:
        f.write(img_bytes)
    
    ps_script = f"""
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | ? {{ $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' }}
    Function Await($WinRtTask, $ResultType) {{
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
    }}
    [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
    [Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null

    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('{tmp_path}')) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    $ocrResult = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $ocrResult.Text
    """
    try:
        res = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
                             capture_output=True, text=True, timeout=8)
        text = res.stdout.strip()
        if tmp_path.exists():
            tmp_path.unlink()
        return text if text else "No text detected on screen."
    except Exception as e:
        if tmp_path.exists():
            tmp_path.unlink()
        return f"Screen captured successfully (OCR note: {e})"

def dynamic_open_app(name: str) -> dict:
    """Finds and launches ANY installed app via Start Menu search, UWP AppID, or system PATH."""
    if not name:
        return {"ok": False, "error": "Application name required"}
    
    clean_name = name.strip()
    known_mappings = {
        "notepad": "notepad.exe",
        "calculator": "calc.exe",
        "calc": "calc.exe",
        "cmd": "cmd.exe",
        "command prompt": "cmd.exe",
        "terminal": "wt.exe",
        "powershell": "powershell.exe",
        "explorer": "explorer.exe",
        "file explorer": "explorer.exe",
        "task manager": "taskmgr.exe",
        "taskmgr": "taskmgr.exe",
        "chrome": "chrome.exe",
        "google chrome": "chrome.exe",
        "edge": "msedge.exe",
        "microsoft edge": "msedge.exe",
        "code": "code.cmd",
        "vs code": "code.cmd",
        "visual studio code": "code.cmd",
        "paint": "mspaint.exe",
        "settings": "ms-settings:",
        "snipping tool": "ms-screenclip:"
    }
    
    low = clean_name.lower()
    if low in known_mappings:
        target = known_mappings[low]
        try:
            if target.startswith("ms-"):
                os.startfile(target)
            else:
                subprocess.Popen(target, shell=True)
            return {"ok": True, "result": f"{clean_name} launched successfully."}
        except Exception:
            pass

    start_menu_dirs = [
        Path(os.environ.get("PROGRAMDATA", "C:\\ProgramData")) / "Microsoft\\Windows\\Start Menu\\Programs",
        Path.home() / "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs"
    ]
    
    for sm_dir in start_menu_dirs:
        if sm_dir.exists():
            for lnk in sm_dir.rglob("*.lnk"):
                if low in lnk.stem.lower():
                    try:
                        os.startfile(str(lnk))
                        return {"ok": True, "result": f"Launched {lnk.stem} from Start Menu."}
                    except Exception:
                        pass

    ps_cmd = f"Get-StartApps | Where-Object {{ $_.Name -like '*{clean_name}*' }} | Select-Object -First 1 -ExpandProperty AppID"
    try:
        p_res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], capture_output=True, text=True, timeout=4)
        appid = p_res.stdout.strip()
        if appid:
            subprocess.Popen(f'explorer.exe "shell:AppsFolder\\{appid}"', shell=True)
            return {"ok": True, "result": f"Launched UWP app {clean_name} (ID: {appid})."}
    except Exception:
        pass

    try:
        subprocess.Popen(f'start "" "{clean_name}"', shell=True)
        return {"ok": True, "result": f"Executed launch command for {clean_name}."}
    except Exception as e:
        return {"ok": False, "error": f"Failed to launch '{clean_name}': {str(e)}"}

def manage_autostart(action: str) -> dict:
    key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
    app_name = "MYRAA"
    exe_target = sys.executable if getattr(sys, "frozen", False) else str(Path(os.getcwd()) / "MYRAA.exe")
    
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS) as key:
            if action == "enable":
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, f'"{exe_target}"')
                return {"ok": True, "enabled": True, "result": "Auto-start enabled successfully in Windows Registry."}
            elif action == "disable":
                try:
                    winreg.DeleteValue(key, app_name)
                except FileNotFoundError:
                    pass
                return {"ok": True, "enabled": False, "result": "Auto-start disabled."}
            else:
                try:
                    val, _ = winreg.QueryValueEx(key, app_name)
                    return {"ok": True, "enabled": True, "path": val, "result": "Auto-start is currently enabled."}
                except FileNotFoundError:
                    return {"ok": True, "enabled": False, "result": "Auto-start is disabled."}
    except Exception as e:
        return {"ok": False, "error": f"Registry auto-start error: {str(e)}"}

class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/health", "/api/health"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "agent": "MYRAA Desktop Agent 2.0"}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path in ("/execute", "/api/execute"):
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                payload = json.loads(body.decode("utf-8"))
            except Exception:
                payload = {}
            
            tool = payload.get("tool", "")
            args = payload.get("args", {})
            log_message("INFO", f"EXEC tool={tool} args={args}")
            
            res = self.dispatch_tool(tool, args)
            log_message("INFO", f"DONE tool={tool} -> {res.get('result') or res.get('error')}")
            
            self.send_response(200 if res.get("ok", True) else 400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(res).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def dispatch_tool(self, tool: str, args: dict) -> dict:
        try:
            if tool in ("takeScreenshot", "screenshot"):
                img_data = capture_screen_image()
                b64_str = base64.b64encode(img_data).decode("utf-8")
                return {"ok": True, "data": b64_str, "format": "base64", "result": "Screenshot captured successfully."}
            
            elif tool == "saveScreenshot":
                img_data = capture_screen_image()
                save_p = resolve_path(args.get("filePath") or args.get("path") or f"screenshots/screenshot_{int(time.time()*1000)}.png")
                save_p.parent.mkdir(parents=True, exist_ok=True)
                with open(save_p, "wb") as f:
                    f.write(img_data)
                return {"ok": True, "path": str(save_p), "result": f"Screenshot saved to {save_p}."}
            
            elif tool in ("readScreen", "analyzeScreenshot"):
                img_data = capture_screen_image()
                ocr_text = perform_windows_ocr(img_data)
                b64_str = base64.b64encode(img_data).decode("utf-8")
                return {
                    "ok": True,
                    "text": ocr_text,
                    "data": b64_str,
                    "result": f"Screen analysis complete. Detected text:\n{ocr_text[:1000]}"
                }
            
            elif tool in ("openApplication", "openApp"):
                return dynamic_open_app(args.get("name") or args.get("application") or args.get("appName"))
            
            elif tool in ("enableAutoStart", "disableAutoStart", "getAutoStartStatus"):
                act = "enable" if tool == "enableAutoStart" else ("disable" if tool == "disableAutoStart" else "status")
                return manage_autostart(act)
            
            elif tool == "systemInfo":
                if HAS_PSUTIL:
                    cpu = psutil.cpu_percent(interval=0.1)
                    mem = psutil.virtual_memory()
                    return {
                        "ok": True,
                        "cpu_percent": cpu,
                        "ram_used_gb": round(mem.used / (1024**3), 2),
                        "ram_total_gb": round(mem.total / (1024**3), 2),
                        "ram_percent": mem.percent,
                        "result": f"CPU: {cpu}%, RAM: {mem.percent}% ({round(mem.used/(1024**3),1)}GB/{round(mem.total/(1024**3),1)}GB)"
                    }
                return {"ok": True, "result": "System active."}
            
            elif tool in ("createFile", "writeCodeFile"):
                p = resolve_path(args.get("filePath") or args.get("path") or args.get("fileName"))
                content = args.get("content", args.get("code", ""))
                p.parent.mkdir(parents=True, exist_ok=True)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(content)
                return {"ok": True, "path": str(p), "result": f"File written: {p} ({len(content)} chars)."}
            
            elif tool == "readFile":
                p = resolve_path(args.get("filePath") or args.get("path"))
                if not p.exists():
                    return {"ok": False, "error": f"File not found: {p}"}
                with open(p, "r", encoding="utf-8", errors="replace") as f:
                    content = f.read(8000)
                return {"ok": True, "content": content, "result": f"Read file {p}."}
            
            elif tool == "deleteFile":
                p = resolve_path(args.get("filePath") or args.get("path"))
                if not p.exists():
                    return {"ok": False, "error": f"File not found: {p}"}
                p.unlink()
                return {"ok": True, "result": f"Deleted file: {p}"}

            elif tool == "openWebsite":
                url = args.get("url") or (f"https://{args.get('name')}.com" if args.get("name") else "https://google.com")
                if not url.startswith("http://") and not url.startswith("https://"):
                    url = "https://" + url
                os.startfile(url)
                return {"ok": True, "result": f"Opened {url} in default browser."}

            elif tool == "runPythonScript":
                p = resolve_path(args.get("path") or args.get("script"))
                if not p.exists():
                    return {"ok": False, "error": f"Script not found: {p}"}
                res = subprocess.run([sys.executable, str(p)], capture_output=True, text=True, timeout=15)
                return {"ok": True, "stdout": res.stdout, "stderr": res.stderr, "result": f"Executed python script {p}."}

            return {"ok": False, "error": f"Tool '{tool}' not supported by desktop agent"}
        except Exception as e:
            log_message("ERROR", f"Error in {tool}: {str(e)}")
            return {"ok": False, "error": str(e)}

    def log_message(self, format, *args):
        pass

def main():
    port = 8765
    server = HTTPServer(("127.0.0.1", port), RequestHandler)
    log_message("INFO", f"Starting MYRAA agent v2.0 on 127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log_message("INFO", "MYRAA agent shutting down.")

if __name__ == "__main__":
    main()
