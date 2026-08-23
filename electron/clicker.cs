using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace MyraaNativeClicker {
    class Program {
        #region Win32 API Definitions

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUT_UNION {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT {
            public uint type;
            public INPUT_UNION u;
        }

        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;
        public const uint INPUT_HARDWARE = 2;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_HWHEEL = 0x1000;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
        public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint KEYEVENTF_SCANCODE = 0x0008;

        public const int SM_XVIRTUALSCREEN = 76;
        public const int SM_YVIRTUALSCREEN = 77;
        public const int SM_CXVIRTUALSCREEN = 78;
        public const int SM_CYVIRTUALSCREEN = 79;
        public const int SM_CXSCREEN = 0;
        public const int SM_CYSCREEN = 1;

        public const int WHEEL_DELTA = 120;

        public const int SW_HIDE = 0;
        public const int SW_SHOWNORMAL = 1;
        public const int SW_SHOWMINIMIZED = 2;
        public const int SW_MAXIMIZE = 3;
        public const int SW_SHOW = 5;
        public const int SW_MINIMIZE = 6;
        public const int SW_RESTORE = 9;

        public const uint WM_CLOSE = 0x0010;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        public static extern short VkKeyScan(char ch);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsZoomed(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        #endregion

        #region CoreAudio COM Interfaces (Master Volume)

        [ComImport]
        [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        private class MMDeviceEnumeratorComObject { }

        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator {
            int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
            int GetDevice(string pwstrId, out IMMDevice ppDevice);
            int RegisterEndpointNotificationCallback(IntPtr pClient);
            int UnregisterEndpointNotificationCallback(IntPtr pClient);
        }

        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice {
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
            int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
            int GetId(out IntPtr ppstrId);
            int GetState(out int pdwState);
        }

        [Guid("5BC63DB8-8835-4D31-840E-0740E7D46D5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume {
            int RegisterControlChangeNotify(IntPtr pNotify);
            int UnregisterControlChangeNotify(IntPtr pNotify);
            int GetChannelCount(out uint pnChannelCount);
            int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
            int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
            int GetMasterVolumeLevel(out float pfLevelDB);
            int GetMasterVolumeLevelScalar(out float pfLevel);
            int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
            int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
            int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
            int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
            int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
            int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
            int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
            int VolumeStepUp(ref Guid pguidEventContext);
            int VolumeStepDown(ref Guid pguidEventContext);
            int QueryHardwareSupport(out uint pdwHardwareSupportMask);
            int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
        }

        #endregion

        static void InitializeDpi() {
            try {
                SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            } catch {
                try {
                    SetProcessDPIAware();
                } catch {}
            }
        }

        #region Mouse Helpers

        static void NormalizeCoordinates(int x, int y, out int normX, out int normY) {
            int vLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
            int vTop = GetSystemMetrics(SM_YVIRTUALSCREEN);
            int vWidth = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            int vHeight = GetSystemMetrics(SM_CYVIRTUALSCREEN);

            if (vWidth == 0) vWidth = GetSystemMetrics(SM_CXSCREEN);
            if (vHeight == 0) vHeight = GetSystemMetrics(SM_CYSCREEN);
            if (vWidth == 0) vWidth = 1920;
            if (vHeight == 0) vHeight = 1080;

            normX = ((x - vLeft) * 65536) / vWidth;
            normY = ((y - vTop) * 65536) / vHeight;
        }

        static void SendMouseMove(int x, int y) {
            SetCursorPos(x, y);
            int normX, normY;
            NormalizeCoordinates(x, y, out normX, out normY);

            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dx = normX;
            inputs[0].u.mi.dy = normY;
            inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
            inputs[0].u.mi.time = 0;
            inputs[0].u.mi.dwExtraInfo = IntPtr.Zero;

            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        static void SendMouseClick(int x, int y, string button = "left", int count = 1, int clickDelayMs = 40) {
            if (x >= 0 && y >= 0) {
                SendMouseMove(x, y);
                Thread.Sleep(20);
            }

            uint downFlag = MOUSEEVENTF_LEFTDOWN;
            uint upFlag = MOUSEEVENTF_LEFTUP;

            string b = (button ?? "left").ToLower().Trim();
            if (b == "right" || b == "r") {
                downFlag = MOUSEEVENTF_RIGHTDOWN;
                upFlag = MOUSEEVENTF_RIGHTUP;
            } else if (b == "middle" || b == "m" || b == "mid") {
                downFlag = MOUSEEVENTF_MIDDLEDOWN;
                upFlag = MOUSEEVENTF_MIDDLEUP;
            }

            for (int i = 0; i < count; i++) {
                INPUT[] downInput = new INPUT[1];
                downInput[0].type = INPUT_MOUSE;
                downInput[0].u.mi.dwFlags = downFlag;
                SendInput(1, downInput, Marshal.SizeOf(typeof(INPUT)));

                Thread.Sleep(clickDelayMs);

                INPUT[] upInput = new INPUT[1];
                upInput[0].type = INPUT_MOUSE;
                upInput[0].u.mi.dwFlags = upFlag;
                SendInput(1, upInput, Marshal.SizeOf(typeof(INPUT)));

                if (i < count - 1) {
                    Thread.Sleep(60);
                }
            }
        }

        static void SendMouseDrag(int startX, int startY, int endX, int endY, string button = "left", int durationMs = 200, int steps = 20) {
            SendMouseMove(startX, startY);
            Thread.Sleep(30);

            uint downFlag = MOUSEEVENTF_LEFTDOWN;
            uint upFlag = MOUSEEVENTF_LEFTUP;
            string b = (button ?? "left").ToLower().Trim();
            if (b == "right" || b == "r") {
                downFlag = MOUSEEVENTF_RIGHTDOWN;
                upFlag = MOUSEEVENTF_RIGHTUP;
            } else if (b == "middle" || b == "m") {
                downFlag = MOUSEEVENTF_MIDDLEDOWN;
                upFlag = MOUSEEVENTF_MIDDLEUP;
            }

            INPUT[] downInput = new INPUT[1];
            downInput[0].type = INPUT_MOUSE;
            downInput[0].u.mi.dwFlags = downFlag;
            SendInput(1, downInput, Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(30);

            if (steps < 2) steps = 2;
            int stepDelay = Math.Max(5, durationMs / steps);

            for (int i = 1; i <= steps; i++) {
                int curX = startX + (int)((endX - startX) * ((double)i / steps));
                int curY = startY + (int)((endY - startY) * ((double)i / steps));
                SendMouseMove(curX, curY);
                Thread.Sleep(stepDelay);
            }

            Thread.Sleep(20);
            INPUT[] upInput = new INPUT[1];
            upInput[0].type = INPUT_MOUSE;
            upInput[0].u.mi.dwFlags = upFlag;
            SendInput(1, upInput, Marshal.SizeOf(typeof(INPUT)));
        }

        static void SendMouseScroll(int amount, string direction = "down") {
            string dir = (direction ?? "down").ToLower().Trim();
            int delta = amount;

            if (dir == "down") {
                delta = -Math.Abs(amount);
            } else if (dir == "up") {
                delta = Math.Abs(amount);
            }

            uint flag = MOUSEEVENTF_WHEEL;
            if (dir == "left" || dir == "right" || dir == "horizontal") {
                flag = MOUSEEVENTF_HWHEEL;
                if (dir == "left") delta = -Math.Abs(amount);
                else delta = Math.Abs(amount);
            }

            INPUT[] input = new INPUT[1];
            input[0].type = INPUT_MOUSE;
            input[0].u.mi.dwFlags = flag;
            input[0].u.mi.mouseData = (uint)delta;
            SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
        }

        #endregion

        #region Keyboard Helpers

        public static void SendUnicodeChar(char ch) {
            INPUT[] inputs = new INPUT[2];

            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = 0;
            inputs[0].u.ki.wScan = (ushort)ch;
            inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[0].u.ki.time = 0;
            inputs[0].u.ki.dwExtraInfo = IntPtr.Zero;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].u.ki.wVk = 0;
            inputs[1].u.ki.wScan = (ushort)ch;
            inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            inputs[1].u.ki.time = 0;
            inputs[1].u.ki.dwExtraInfo = IntPtr.Zero;

            SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void SendUnicodeText(string text, int charDelayMs = 5) {
            if (string.IsNullOrEmpty(text)) return;

            for (int i = 0; i < text.Length; i++) {
                char ch = text[i];
                if (char.IsHighSurrogate(ch) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1])) {
                    char low = text[++i];
                    SendUnicodeChar(ch);
                    SendUnicodeChar(low);
                } else {
                    SendUnicodeChar(ch);
                }
                if (charDelayMs > 0) Thread.Sleep(charDelayMs);
            }
        }

        public static ushort ParseKey(string keyName) {
            if (string.IsNullOrEmpty(keyName)) return 0;
            string k = keyName.Trim().ToLower();

            switch (k) {
                case "enter": case "return": return 0x0D;
                case "tab": return 0x09;
                case "esc": case "escape": return 0x1B;
                case "backspace": case "back": case "bksp": return 0x08;
                case "delete": case "del": return 0x2E;
                case "insert": case "ins": return 0x2D;
                case "space": case "spacebar": return 0x20;
                case "up": case "arrowup": return 0x26;
                case "down": case "arrowdown": return 0x28;
                case "left": case "arrowleft": return 0x25;
                case "right": case "arrowright": return 0x27;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": case "pgup": return 0x21;
                case "pagedown": case "pgdn": return 0x22;
                case "ctrl": case "control": return 0x11;
                case "lctrl": case "lcontrol": return 0xA2;
                case "rctrl": case "rcontrol": return 0xA3;
                case "shift": return 0x10;
                case "lshift": return 0xA0;
                case "rshift": return 0xA1;
                case "alt": case "menu": return 0x12;
                case "lalt": return 0xA4;
                case "ralt": return 0xA5;
                case "win": case "windows": case "lwin": case "meta": case "cmd": return 0x5B;
                case "rwin": return 0x5C;
                case "capslock": case "caps": return 0x14;
                case "printscreen": case "prtsc": case "prntscrn": return 0x2C;
                case "scrolllock": return 0x91;
                case "pause": case "break": return 0x13;
                case "numlock": return 0x90;
                case "f1": return 0x70;
                case "f2": return 0x71;
                case "f3": return 0x72;
                case "f4": return 0x73;
                case "f5": return 0x74;
                case "f6": return 0x75;
                case "f7": return 0x76;
                case "f8": return 0x77;
                case "f9": return 0x78;
                case "f10": return 0x79;
                case "f11": return 0x7A;
                case "f12": return 0x7B;
                case "volumeup": case "volup": return 0xAF;
                case "volumedown": case "voldown": return 0xAE;
                case "volumemute": case "mute": return 0xAD;
                case "mediaplaypause": case "playpause": return 0xB3;
                case "medianext": case "nexttrack": return 0xB0;
                case "mediaprev": case "prevtrack": return 0xB1;
                case "mediastop": return 0xB2;
                default:
                    if (k.Length == 1) {
                        char c = k[0];
                        if (c >= 'a' && c <= 'z') return (ushort)(c - 'a' + 0x41);
                        if (c >= '0' && c <= '9') return (ushort)(c - '0' + 0x30);
                        short vk = VkKeyScan(c);
                        if (vk != -1) return (ushort)(vk & 0xFF);
                    }
                    return 0;
            }
        }

        public static void SendKeyDown(ushort vk) {
            INPUT[] input = new INPUT[1];
            input[0].type = INPUT_KEYBOARD;
            input[0].u.ki.wVk = vk;
            input[0].u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
            input[0].u.ki.dwFlags = 0;
            input[0].u.ki.time = 0;
            input[0].u.ki.dwExtraInfo = IntPtr.Zero;
            SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void SendKeyUp(ushort vk) {
            INPUT[] input = new INPUT[1];
            input[0].type = INPUT_KEYBOARD;
            input[0].u.ki.wVk = vk;
            input[0].u.ki.wScan = (ushort)MapVirtualKey(vk, 0);
            input[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
            input[0].u.ki.time = 0;
            input[0].u.ki.dwExtraInfo = IntPtr.Zero;
            SendInput(1, input, Marshal.SizeOf(typeof(INPUT)));
        }

        public static void SendKeyPress(ushort vk, int holdMs = 20) {
            SendKeyDown(vk);
            if (holdMs > 0) Thread.Sleep(holdMs);
            SendKeyUp(vk);
        }

        public static void SendHotkey(string combo) {
            if (string.IsNullOrEmpty(combo)) return;
            string[] parts = combo.Split(new char[] { '+', '-' }, StringSplitOptions.RemoveEmptyEntries);
            List<ushort> vks = new List<ushort>();

            foreach (string p in parts) {
                ushort vk = ParseKey(p);
                if (vk != 0) vks.Add(vk);
            }

            if (vks.Count == 0) return;

            // Press all in forward order
            for (int i = 0; i < vks.Count; i++) {
                SendKeyDown(vks[i]);
                Thread.Sleep(10);
            }

            Thread.Sleep(30);

            // Release all in reverse order
            for (int i = vks.Count - 1; i >= 0; i--) {
                SendKeyUp(vks[i]);
                Thread.Sleep(10);
            }
        }

        #endregion

        #region Window Management & Foreground Activation

        public class WindowInfo {
            public IntPtr Handle;
            public string Title;
            public string ProcessName;
            public uint ProcessId;
            public bool IsMinimized;
            public bool IsMaximized;
            public RECT Rect;
        }

        public static List<WindowInfo> GetOpenWindows() {
            List<WindowInfo> windows = new List<WindowInfo>();
            Dictionary<IntPtr, bool> seen = new Dictionary<IntPtr, bool>();

            EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
                if (!seen.ContainsKey(hWnd)) {
                    seen[hWnd] = true;
                    int length = GetWindowTextLength(hWnd);
                    StringBuilder builder = new StringBuilder(length + 1);
                    if (length > 0) GetWindowText(hWnd, builder, builder.Capacity);
                    string title = builder.ToString();

                    uint pid;
                    GetWindowThreadProcessId(hWnd, out pid);
                    string procName = "";
                    try {
                        Process p = Process.GetProcessById((int)pid);
                        procName = p.ProcessName;
                    } catch {}

                    if (!string.IsNullOrWhiteSpace(title) || (!string.IsNullOrWhiteSpace(procName) && IsWindowVisible(hWnd))) {
                        RECT r;
                        GetWindowRect(hWnd, out r);
                        windows.Add(new WindowInfo {
                            Handle = hWnd,
                            Title = string.IsNullOrWhiteSpace(title) ? procName : title,
                            ProcessName = procName,
                            ProcessId = pid,
                            IsMinimized = IsIconic(hWnd),
                            IsMaximized = IsZoomed(hWnd),
                            Rect = r
                        });
                    }
                }
                return true;
            }, IntPtr.Zero);

            try {
                Process[] procs = Process.GetProcesses();
                foreach (Process p in procs) {
                    try {
                        if (p.MainWindowHandle != IntPtr.Zero && !seen.ContainsKey(p.MainWindowHandle)) {
                            seen[p.MainWindowHandle] = true;
                            RECT r;
                            GetWindowRect(p.MainWindowHandle, out r);
                            windows.Add(new WindowInfo {
                                Handle = p.MainWindowHandle,
                                Title = !string.IsNullOrWhiteSpace(p.MainWindowTitle) ? p.MainWindowTitle : p.ProcessName,
                                ProcessName = p.ProcessName,
                                ProcessId = (uint)p.Id,
                                IsMinimized = IsIconic(p.MainWindowHandle),
                                IsMaximized = IsZoomed(p.MainWindowHandle),
                                Rect = r
                            });
                        }
                    } catch {}
                }

                if (windows.Count == 0) {
                    foreach (Process p in procs) {
                        try {
                            if (p.Id > 4 && !string.IsNullOrWhiteSpace(p.ProcessName) && p.ProcessName != "System" && p.ProcessName != "Idle") {
                                windows.Add(new WindowInfo {
                                    Handle = p.MainWindowHandle != IntPtr.Zero ? p.MainWindowHandle : (IntPtr)p.Id,
                                    Title = !string.IsNullOrWhiteSpace(p.MainWindowTitle) ? p.MainWindowTitle : p.ProcessName,
                                    ProcessName = p.ProcessName,
                                    ProcessId = (uint)p.Id,
                                    IsMinimized = false,
                                    IsMaximized = false,
                                    Rect = new RECT { Left = 0, Top = 0, Right = 1920, Bottom = 1080 }
                                });
                            }
                        } catch {}
                    }
                }
            } catch {}

            return windows;
        }

        public static bool ForceForegroundWindow(IntPtr hWnd) {
            if (hWnd == IntPtr.Zero) return false;

            if (IsIconic(hWnd)) {
                ShowWindowAsync(hWnd, SW_RESTORE);
                Thread.Sleep(50);
            }

            IntPtr fgWnd = GetForegroundWindow();
            uint fgThread = 0;
            if (fgWnd != IntPtr.Zero) {
                uint dummy;
                fgThread = GetWindowThreadProcessId(fgWnd, out dummy);
            }
            uint curThread = GetCurrentThreadId();
            uint targetDummy;
            uint targetThread = GetWindowThreadProcessId(hWnd, out targetDummy);

            bool attachedCur = false;
            bool attachedFg = false;

            try {
                if (curThread != targetThread) {
                    attachedCur = AttachThreadInput(curThread, targetThread, true);
                }
                if (fgThread != 0 && fgThread != targetThread) {
                    attachedFg = AttachThreadInput(fgThread, targetThread, true);
                }

                BringWindowToTop(hWnd);
                ShowWindowAsync(hWnd, SW_SHOW);
                SetForegroundWindow(hWnd);
                SwitchToThisWindow(hWnd, true);
            } finally {
                if (attachedCur) AttachThreadInput(curThread, targetThread, false);
                if (attachedFg) AttachThreadInput(fgThread, targetThread, false);
            }

            return true;
        }

        public static WindowInfo FindWindowByQuery(string query) {
            if (string.IsNullOrWhiteSpace(query)) return null;
            string q = query.ToLower().Trim();

            List<WindowInfo> windows = GetOpenWindows();

            // 1. Exact match on title or process name
            foreach (var w in windows) {
                if (w.Title.ToLower() == q || w.ProcessName.ToLower() == q) return w;
            }

            // 2. StartsWith match
            foreach (var w in windows) {
                if (w.Title.ToLower().StartsWith(q) || w.ProcessName.ToLower().StartsWith(q)) return w;
            }

            // 3. Substring match
            foreach (var w in windows) {
                if (w.Title.ToLower().Contains(q) || w.ProcessName.ToLower().Contains(q)) return w;
            }

            return null;
        }

        public static string ResolveAppTarget(string input) {
            string trimmed = (input ?? "").Trim().ToLower();
            Dictionary<string, string> known = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
                { "notepad", "notepad.exe" },
                { "notes", "notepad.exe" },
                { "calc", "calc.exe" },
                { "calculator", "calc.exe" },
                { "paint", "mspaint.exe" },
                { "mspaint", "mspaint.exe" },
                { "explorer", "explorer.exe" },
                { "files", "explorer.exe" },
                { "file explorer", "explorer.exe" },
                { "cmd", "cmd.exe" },
                { "command prompt", "cmd.exe" },
                { "powershell", "powershell.exe" },
                { "terminal", "wt.exe" },
                { "windows terminal", "wt.exe" },
                { "chrome", "chrome.exe" },
                { "google chrome", "chrome.exe" },
                { "edge", "msedge.exe" },
                { "microsoft edge", "msedge.exe" },
                { "browser", "chrome.exe" },
                { "vscode", "code.cmd" },
                { "code", "code.cmd" },
                { "visual studio code", "code.cmd" },
                { "cursor", "cursor.exe" },
                { "spotify", "spotify.exe" },
                { "discord", "discord.exe" },
                { "telegram", "telegram.exe" },
                { "task manager", "taskmgr.exe" },
                { "taskmgr", "taskmgr.exe" },
                { "settings", "ms-settings:" },
                { "snipping tool", "ms-screenclip:" }
            };

            if (known.ContainsKey(trimmed)) return known[trimmed];
            return input;
        }

        public static bool LaunchForegroundApp(string appName, out string outputMsg) {
            if (string.IsNullOrWhiteSpace(appName)) {
                outputMsg = "Application name cannot be empty";
                return false;
            }

            string target = ResolveAppTarget(appName);

            // First check if an existing window for this application is already open
            WindowInfo existing = FindWindowByQuery(appName);
            if (existing == null && target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                existing = FindWindowByQuery(Path.GetFileNameWithoutExtension(target));
            }

            if (existing != null) {
                ForceForegroundWindow(existing.Handle);
                outputMsg = "{\"success\":true,\"action\":\"activate\",\"app\":\"" + appName + "\",\"title\":\"" + EscapeJson(existing.Title) + "\",\"hwnd\":" + (long)existing.Handle + "}";
                return true;
            }

            // Launch via Windows Shell
            try {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = target;
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Normal;

                Process p = Process.Start(psi);

                // Wait briefly for main window handle and bring to foreground
                for (int i = 0; i < 4; i++) {
                    Thread.Sleep(40);
                    WindowInfo newWin = FindWindowByQuery(appName);
                    if (newWin == null && target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                        newWin = FindWindowByQuery(Path.GetFileNameWithoutExtension(target));
                    }
                    if (newWin != null) {
                        ForceForegroundWindow(newWin.Handle);
                        outputMsg = "{\"success\":true,\"action\":\"launch\",\"app\":\"" + appName + "\",\"title\":\"" + EscapeJson(newWin.Title) + "\",\"status\":\"foreground\"}";
                        return true;
                    }
                }

                outputMsg = "{\"success\":true,\"action\":\"launch\",\"app\":\"" + appName + "\",\"status\":\"spawned\"}";
                return true;
            } catch (Exception ex) {
                if (target.Contains(":") || File.Exists(target) || Directory.Exists(target)) {
                    try {
                        Process.Start("explorer.exe", target);
                        outputMsg = "{\"success\":true,\"action\":\"launch\",\"app\":\"" + appName + "\",\"status\":\"explorer_shell\"}";
                        return true;
                    } catch (Exception ex2) {
                        outputMsg = "{\"success\":false,\"error\":\"" + EscapeJson(ex2.Message) + "\"}";
                        return false;
                    }
                } else {
                    outputMsg = "{\"success\":false,\"error\":\"Application not found: " + EscapeJson(ex.Message) + "\"}";
                    return false;
                }
            }
        }

        #endregion

        #region Master Volume Control (CoreAudio)

        private static IAudioEndpointVolume GetMasterAudioVolume() {
            try {
                MMDeviceEnumeratorComObject enumeratorObj = new MMDeviceEnumeratorComObject();
                IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)enumeratorObj;
                IMMDevice device;
                enumerator.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out device);
                if (device == null) return null;

                Guid iidIAudioEndpointVolume = typeof(IAudioEndpointVolume).GUID;
                object o;
                device.Activate(ref iidIAudioEndpointVolume, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o);
                return (IAudioEndpointVolume)o;
            } catch {
                return null;
            }
        }

        public static float GetMasterVolume() {
            try {
                IAudioEndpointVolume master = GetMasterAudioVolume();
                if (master != null) {
                    float current;
                    master.GetMasterVolumeLevelScalar(out current);
                    return (float)Math.Round(current * 100f, 1);
                }
            } catch {}
            return 50f;
        }

        public static void SetMasterVolume(float percent) {
            percent = Math.Max(0f, Math.Min(100f, percent));
            try {
                IAudioEndpointVolume master = GetMasterAudioVolume();
                if (master != null) {
                    Guid empty = Guid.Empty;
                    master.SetMasterVolumeLevelScalar(percent / 100f, ref empty);
                    return;
                }
            } catch {}

            // Fallback via Volume Keys
            SendKeyPress(0xAF);
        }

        public static bool ToggleMute() {
            try {
                IAudioEndpointVolume master = GetMasterAudioVolume();
                if (master != null) {
                    bool currentMute;
                    master.GetMute(out currentMute);
                    Guid empty = Guid.Empty;
                    master.SetMute(!currentMute, ref empty);
                    return !currentMute;
                }
            } catch {}

            SendKeyPress(0xAD);
            return false;
        }

        #endregion

        #region Display Brightness Control (WMI)

        public static int GetBrightness() {
            try {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\wmi", "SELECT CurrentBrightness FROM WmiMonitorBrightness")) {
                    foreach (ManagementObject obj in searcher.Get()) {
                        return Convert.ToInt32(obj["CurrentBrightness"]);
                    }
                }
            } catch {}
            return 75;
        }

        public static bool SetBrightness(int target) {
            target = Math.Max(0, Math.Min(100, target));
            try {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher("root\\wmi", "SELECT * FROM WmiMonitorBrightnessMethods")) {
                    foreach (ManagementObject obj in searcher.Get()) {
                        obj.InvokeMethod("WmiSetBrightness", new object[] { 1, (byte)target });
                        return true;
                    }
                }
            } catch {}
            return false;
        }

        #endregion

        #region Helper Utilities

        private static string EscapeJson(string str) {
            if (string.IsNullOrEmpty(str)) return "";
            return str.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "\\n").Replace("\t", "\\t");
        }

        #endregion

        [STAThread]
        static void Main(string[] args) {
            try {
                InitializeDpi();

                if (args.Length == 0) {
                    Console.WriteLine("{\"status\":\"ok\",\"engine\":\"MyraaNativeClicker 3.0\"}");
                    return;
                }

                string first = args[0].ToLower().Trim();

                // Check if first argument is a numeric coordinate (legacy 4-arg click: clicker.exe <x> <y> [button] [count])
                int testX;
                if (int.TryParse(first, out testX)) {
                    int x = testX;
                    int y = -1;
                    string btn = "left";
                    int count = 1;

                    if (args.Length >= 2) int.TryParse(args[1], out y);
                    if (args.Length >= 3) btn = args[2];
                    if (args.Length >= 4) int.TryParse(args[3], out count);

                    SendMouseClick(x, y, btn, Math.Max(1, count));
                    Console.WriteLine("{\"success\":true,\"action\":\"click\",\"x\":" + x + ",\"y\":" + y + ",\"button\":\"" + btn + "\",\"count\":" + count + "}");
                    return;
                }

                // Subcommand dispatch
                switch (first) {
                    case "resolve": {
                        string targetApp = args.Length > 1 ? args[1] : "";
                        string resolved = ResolveAppTarget(targetApp);
                        Console.WriteLine("{\"success\":true,\"action\":\"resolve\",\"app\":\"" + EscapeJson(targetApp) + "\",\"target\":\"" + EscapeJson(resolved) + "\"}");
                        break;
                    }
                    case "click": {
                        int x = -1, y = -1, count = 1;
                        string btn = "left";
                        if (args.Length >= 2) int.TryParse(args[1], out x);
                        if (args.Length >= 3) int.TryParse(args[2], out y);
                        if (args.Length >= 4) btn = args[3];
                        if (args.Length >= 5) int.TryParse(args[4], out count);

                        SendMouseClick(x, y, btn, Math.Max(1, count));
                        Console.WriteLine("{\"success\":true,\"action\":\"click\",\"x\":" + x + ",\"y\":" + y + ",\"button\":\"" + btn + "\",\"count\":" + count + "}");
                        break;
                    }
                    case "move": {
                        int x = 0, y = 0;
                        if (args.Length >= 2) int.TryParse(args[1], out x);
                        if (args.Length >= 3) int.TryParse(args[2], out y);
                        SendMouseMove(x, y);
                        Console.WriteLine("{\"success\":true,\"action\":\"move\",\"x\":" + x + ",\"y\":" + y + "}");
                        break;
                    }
                    case "drag": {
                        int startX = 0, startY = 0, endX = 0, endY = 0, durationMs = 200;
                        string btn = "left";
                        if (args.Length >= 2) int.TryParse(args[1], out startX);
                        if (args.Length >= 3) int.TryParse(args[2], out startY);
                        if (args.Length >= 4) int.TryParse(args[3], out endX);
                        if (args.Length >= 5) int.TryParse(args[4], out endY);
                        if (args.Length >= 6) btn = args[5];
                        if (args.Length >= 7) int.TryParse(args[6], out durationMs);

                        SendMouseDrag(startX, startY, endX, endY, btn, durationMs);
                        Console.WriteLine("{\"success\":true,\"action\":\"drag\",\"startX\":" + startX + ",\"startY\":" + startY + ",\"endX\":" + endX + ",\"endY\":" + endY + "}");
                        break;
                    }
                    case "scroll": {
                        int amount = 120;
                        string dir = "down";
                        if (args.Length >= 2) int.TryParse(args[1], out amount);
                        if (args.Length >= 3) dir = args[2];
                        SendMouseScroll(amount, dir);
                        Console.WriteLine("{\"success\":true,\"action\":\"scroll\",\"amount\":" + amount + ",\"direction\":\"" + dir + "\"}");
                        break;
                    }
                    case "type": {
                        string text = args.Length >= 2 ? args[1] : "";
                        int delay = 5;
                        if (args.Length >= 3) int.TryParse(args[2], out delay);
                        SendUnicodeText(text, delay);
                        Console.WriteLine("{\"success\":true,\"action\":\"type\",\"chars\":" + text.Length + "}");
                        break;
                    }
                    case "key": case "hotkey": case "press": {
                        string combo = args.Length >= 2 ? args[1] : "";
                        SendHotkey(combo);
                        Console.WriteLine("{\"success\":true,\"action\":\"hotkey\",\"combo\":\"" + combo + "\"}");
                        break;
                    }
                    case "pos": case "getpos": {
                        POINT pt;
                        GetCursorPos(out pt);
                        Console.WriteLine("{\"success\":true,\"x\":" + pt.X + ",\"y\":" + pt.Y + "}");
                        break;
                    }
                    case "launch": {
                        string appName = args.Length >= 2 ? args[1] : "";
                        string resMsg;
                        LaunchForegroundApp(appName, out resMsg);
                        Console.WriteLine(resMsg);
                        break;
                    }
                    case "activate": case "focus": {
                        string query = args.Length >= 2 ? args[1] : "";
                        WindowInfo win = FindWindowByQuery(query);
                        if (win != null) {
                            ForceForegroundWindow(win.Handle);
                            Console.WriteLine("{\"success\":true,\"action\":\"activate\",\"title\":\"" + EscapeJson(win.Title) + "\",\"proc\":\"" + win.ProcessName + "\",\"hwnd\":" + (long)win.Handle + "}");
                        } else {
                            Console.WriteLine("{\"success\":false,\"error\":\"Window not found for query '" + EscapeJson(query) + "'\"}");
                        }
                        break;
                    }
                    case "window": {
                        string action = args.Length >= 2 ? args[1].ToLower().Trim() : "list";
                        string target = args.Length >= 3 ? args[2] : "";

                        if (action == "list") {
                            List<WindowInfo> wins = GetOpenWindows();
                            StringBuilder sb = new StringBuilder();
                            sb.Append("{\"success\":true,\"action\":\"window_list\",\"count\":").Append(wins.Count).Append(",\"windows\":[");
                            for (int i = 0; i < wins.Count; i++) {
                                var w = wins[i];
                                sb.Append("{\"hwnd\":").Append((long)w.Handle)
                                  .Append(",\"title\":\"").Append(EscapeJson(w.Title)).Append("\"")
                                  .Append(",\"proc\":\"").Append(w.ProcessName).Append("\"")
                                  .Append(",\"pid\":").Append(w.ProcessId)
                                  .Append(",\"minimized\":").Append(w.IsMinimized.ToString().ToLower())
                                  .Append(",\"maximized\":").Append(w.IsMaximized.ToString().ToLower())
                                  .Append(",\"x\":").Append(w.Rect.Left)
                                  .Append(",\"y\":").Append(w.Rect.Top)
                                  .Append(",\"w\":").Append(w.Rect.Right - w.Rect.Left)
                                  .Append(",\"h\":").Append(w.Rect.Bottom - w.Rect.Top)
                                  .Append("}");
                                if (i < wins.Count - 1) sb.Append(",");
                            }
                            sb.Append("]}");
                            Console.WriteLine(sb.ToString());
                            break;
                        }

                        WindowInfo targetWin = !string.IsNullOrEmpty(target) ? FindWindowByQuery(target) : null;
                        IntPtr hWnd = targetWin != null ? targetWin.Handle : GetForegroundWindow();

                        if (hWnd == IntPtr.Zero) {
                            List<WindowInfo> wins = GetOpenWindows();
                            if (wins.Count > 0) {
                                targetWin = wins[0];
                                hWnd = targetWin.Handle;
                            }
                        }

                        if (hWnd == IntPtr.Zero) {
                            hWnd = (IntPtr)Process.GetCurrentProcess().Id;
                        }

                        switch (action) {
                            case "minimize":
                                ShowWindowAsync(hWnd, SW_MINIMIZE);
                                Console.WriteLine("{\"success\":true,\"action\":\"minimize\",\"hwnd\":" + (long)hWnd + "}");
                                break;
                            case "maximize":
                                ShowWindowAsync(hWnd, SW_MAXIMIZE);
                                Console.WriteLine("{\"success\":true,\"action\":\"maximize\",\"hwnd\":" + (long)hWnd + "}");
                                break;
                            case "restore":
                                ShowWindowAsync(hWnd, SW_RESTORE);
                                Console.WriteLine("{\"success\":true,\"action\":\"restore\",\"hwnd\":" + (long)hWnd + "}");
                                break;
                            case "close":
                                PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                                Console.WriteLine("{\"success\":true,\"action\":\"close\",\"hwnd\":" + (long)hWnd + "}");
                                break;
                            case "rect": {
                                RECT r;
                                GetWindowRect(hWnd, out r);
                                Console.WriteLine("{\"success\":true,\"action\":\"rect\",\"x\":" + r.Left + ",\"y\":" + r.Top + ",\"w\":" + (r.Right - r.Left) + ",\"h\":" + (r.Bottom - r.Top) + "}");
                                break;
                            }
                            case "active": {
                                int len = GetWindowTextLength(hWnd);
                                StringBuilder sb = new StringBuilder(len + 1);
                                GetWindowText(hWnd, sb, sb.Capacity);
                                uint pid;
                                GetWindowThreadProcessId(hWnd, out pid);
                                Console.WriteLine("{\"success\":true,\"action\":\"active\",\"title\":\"" + EscapeJson(sb.ToString()) + "\",\"pid\":" + pid + ",\"hwnd\":" + (long)hWnd + "}");
                                break;
                            }
                            default:
                                Console.WriteLine("{\"error\":\"Unknown window action '" + action + "'\"}");
                                break;
                        }
                        break;
                    }
                    case "volume": {
                        string op = args.Length >= 2 ? args[1].ToLower().Trim() : "get";
                        if (op == "up") {
                            float cur = GetMasterVolume();
                            SetMasterVolume(cur + 6f);
                            Console.WriteLine("{\"success\":true,\"action\":\"volume_up\",\"level\":" + GetMasterVolume() + "}");
                        } else if (op == "down") {
                            float cur = GetMasterVolume();
                            SetMasterVolume(cur - 6f);
                            Console.WriteLine("{\"success\":true,\"action\":\"volume_down\",\"level\":" + GetMasterVolume() + "}");
                        } else if (op == "mute") {
                            bool muted = ToggleMute();
                            Console.WriteLine("{\"success\":true,\"action\":\"volume_mute\",\"muted\":" + muted.ToString().ToLower() + "}");
                        } else if (op == "set") {
                            float lvl = 50f;
                            if (args.Length >= 3) float.TryParse(args[2], out lvl);
                            SetMasterVolume(lvl);
                            Console.WriteLine("{\"success\":true,\"action\":\"volume_set\",\"level\":" + GetMasterVolume() + "}");
                        } else {
                            Console.WriteLine("{\"success\":true,\"action\":\"volume_get\",\"level\":" + GetMasterVolume() + "}");
                        }
                        break;
                    }
                    case "brightness": {
                        string op = args.Length >= 2 ? args[1].ToLower().Trim() : "get";
                        if (op == "up") {
                            int cur = GetBrightness();
                            SetBrightness(cur + 10);
                            Console.WriteLine("{\"success\":true,\"action\":\"brightness_up\",\"level\":" + GetBrightness() + "}");
                        } else if (op == "down") {
                            int cur = GetBrightness();
                            SetBrightness(cur - 10);
                            Console.WriteLine("{\"success\":true,\"action\":\"brightness_down\",\"level\":" + GetBrightness() + "}");
                        } else if (op == "set") {
                            int lvl = 75;
                            if (args.Length >= 3) int.TryParse(args[2], out lvl);
                            SetBrightness(lvl);
                            Console.WriteLine("{\"success\":true,\"action\":\"brightness_set\",\"level\":" + GetBrightness() + "}");
                        } else {
                            Console.WriteLine("{\"success\":true,\"action\":\"brightness_get\",\"level\":" + GetBrightness() + "}");
                        }
                        break;
                    }
                    case "clipboard": {
                        string op = args.Length >= 2 ? args[1].ToLower().Trim() : "get";
                        if (op == "get") {
                            string text = Clipboard.ContainsText() ? Clipboard.GetText() : "";
                            Console.WriteLine("{\"success\":true,\"action\":\"clipboard_get\",\"text\":\"" + EscapeJson(text) + "\"}");
                        } else if (op == "set") {
                            string text = args.Length >= 3 ? args[2] : "";
                            Clipboard.SetText(text);
                            Console.WriteLine("{\"success\":true,\"action\":\"clipboard_set\",\"length\":" + text.Length + "}");
                        } else if (op == "clear") {
                            Clipboard.Clear();
                            Console.WriteLine("{\"success\":true,\"action\":\"clipboard_clear\"}");
                        }
                        break;
                    }
                    default: {
                        Console.WriteLine("{\"error\":\"Unknown subcommand '" + first + "'\"}");
                        break;
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}");
            }
        }
    }
}
