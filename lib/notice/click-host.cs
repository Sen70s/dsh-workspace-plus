// dsh-notice click host: one windowless activation of a toast click.
//
// Windows resolves a protocol activation to the command line this plugin writes
// under HKCU\Software\Classes\<scheme>\shell\open\command, and that command used
// to run powershell.exe -WindowStyle Hidden. On a machine where Windows Terminal
// is the default terminal host, -WindowStyle Hidden hides the PowerShell window
// but NOT the terminal host Windows spawns for it, so every click flashed a full
// Windows Terminal window for two to four seconds. A GUI-subsystem executable has
// no console at all, so there is nothing to flash in the first place.
//
// The work is deliberately split into two phases:
//
//   1. HTTP FIRST. The activated URL is forwarded to the running host's loopback
//      route. The host owns the protocol bookkeeping; this helper is only a
//      courier and never interprets the URL.
//   2. FOCUS SECOND. Showing and foregrounding the desktop window makes the page
//      fire its focus event, and the page answers that event by polling for the
//      intent phase 1 just recorded. Doing this in the other order would race:
//      the page could poll before the intent exists and open nothing.
//
// A click must never do nothing, so every way of failing ends in either a focus
// attempt or the application's own dsh://open activation.
//
// Build (no project file and no NuGet; the .NET Framework 4.0 compiler is enough,
// which is why this file stays C# 5 compatible and pure ASCII):
//
//   csc.exe /nologo /target:winexe /optimize+ /out:click-host.exe click-host.cs
//
// Usage:
//
//   click-host.exe <port> <token> <focus:0|1> "<activated-url>"
//   click-host.exe --selftest        (exit code 0; used by the build step)
//
// Exit codes: 0 for every normal activation (the fallbacks are part of success),
// 2 for a malformed command line.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class ClickHost
{
    // --- window constants ----------------------------------------------------
    //
    // The only window-state change this helper is allowed to make is restoring a
    // minimized window: SW_RESTORE returns it to the state it had before it was
    // minimized, which may well be maximized.
    //
    // Deliberately absent: SW_SHOWNORMAL (1) and SW_SHOW (5). Both were measured
    // live to un-maximize this Chromium window when called on an already-visible
    // window: SW_SHOWNORMAL forces normal size, and even SW_SHOW (documented as
    // "shows the window in its current state") reset a maximized window from
    // 1550x878 to 1295x800 in the compiled helper while the same call from
    // PowerShell P/Invoke did not. A click must never touch the placement of a
    // window the user can already see, so any ShowWindow call other than
    // SW_RESTORE for an iconic window is forbidden. A hidden window is made
    // visible with SetWindowPos(SWP_SHOWWINDOW) instead, which sets WS_VISIBLE
    // without going through ShowWindow's placement logic.
    private const int SW_RESTORE = 9;

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_SHOWWINDOW = 0x0040;

    /// <summary>Process name the desktop application ships under.</summary>
    private const string TargetProcessName = "DeepSeek Harness";

    /// <summary>
    /// Chromium's top-level window class, the one that carries the actual UI.
    /// </summary>
    private const string TargetWindowClass = "Chrome_WidgetWin_1";

    // --- time budget ---------------------------------------------------------
    //
    // A click is a UI gesture: waiting seconds for it is already a failure. The
    // whole activation is therefore bounded, and every wait below draws from the
    // same remaining budget rather than adding its own timeout.

    private const int TotalBudgetMs = 4000;
    private const int HttpTimeoutMs = 2500;
    private const int ForegroundWaitMs = 800;
    private const int ShowFallbackWaitMs = 1500;

    // --- win32 ---------------------------------------------------------------

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ignored);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool attachFlag);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    /// <summary>Diagnostic log target; empty unless DSH_NOTICE_CLICK_LOG is set.</summary>
    private static string logPath = "";

    /// <summary>Activation-relative clock used to keep the whole click bounded.</summary>
    private static readonly Stopwatch Clock = Stopwatch.StartNew();

    /// <summary>
    /// Entry point.
    /// </summary>
    /// <param name="args">port, token, focus flag and the activated URL.</param>
    /// <returns>0 for a normal activation, 2 for a malformed command line.</returns>
    public static int Main(string[] args)
    {
        // The build step runs the freshly compiled binary once to prove it starts
        // and exits cleanly. There is nothing to activate in that mode, and it
        // must not need a host or a window.
        if (args.Length == 1 && string.Equals(args[0], "--selftest", StringComparison.Ordinal)) return 0;

        logPath = Environment.GetEnvironmentVariable("DSH_NOTICE_CLICK_LOG") ?? "";

        int port;
        if (args.Length < 4 || !int.TryParse(args[0], out port) || port < 1 || port > 65535) return 2;

        string token = args[1];
        bool focus = string.Equals(args[2], "1", StringComparison.Ordinal);
        string url = args[3];
        Log("start focus=" + (focus ? "1" : "0") + " port=" + port);

        // Phase 1: hand the activated URL to the host. The host owns the token
        // check and the session bookkeeping; this process never interprets it.
        bool delivered = Deliver(port, token, url);
        Log("http " + (delivered ? "ok" : "fail"));

        if (!focus)
        {
            // A "record only" activation (focus=0) has nothing else to do. It
            // still exits 0 when the HTTP request failed: the click has already
            // been recorded as best it can be, and nothing visible is expected.
            Log("done");
            return 0;
        }

        // Phase 2: show and foreground the desktop window.
        IntPtr hwnd = FindWindow();
        bool focused = false;
        if (hwnd != IntPtr.Zero)
        {
            focused = ForceForeground(hwnd);
            Log("focus " + (focused ? "ok" : "fail"));
        }
        else
        {
            Log("window not found");
        }

        // Never do nothing. When the host did not answer, or no window could be
        // found at all, ask the application itself through its own protocol: its
        // single-instance path shows the primary window and focuses it.
        if (!delivered || hwnd == IntPtr.Zero)
        {
            Log("fallback dsh://open");
            ShellOpen("dsh://open");
        }

        Log("done");
        return 0;
    }

    /// <summary>
    /// Forward the activated URL to the host's loopback route.
    /// </summary>
    /// <remarks>
    /// Both the token and the URL are escaped with Uri.EscapeDataString: the URL
    /// carries its own query string, and an unescaped ampersand would end the
    /// outer query value and silently change what the host parses.
    ///
    /// The proxy is disabled outright. A machine-wide proxy must never be asked
    /// to resolve 127.0.0.1, and an unreachable proxy would delay a click for
    /// as long as its connect timeout.
    ///
    /// Any HTTP answer counts as delivery: a 403 for a stale token or a 400 for a
    /// malformed URL still proves the host is alive and listening, which is what
    /// decides whether the dsh://open fallback below is needed.
    /// </remarks>
    /// <param name="port">Loopback port the host listens on.</param>
    /// <param name="token">Per-process secret the host issued.</param>
    /// <param name="url">Activated protocol URL, forwarded verbatim.</param>
    /// <returns>true when the host answered.</returns>
    private static bool Deliver(int port, string token, string url)
    {
        try
        {
            string endpoint = "http://127.0.0.1:" + port + "/dsh-notice/api/open?token=" +
                Uri.EscapeDataString(token) + "&url=" + Uri.EscapeDataString(url);

            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(endpoint);
            request.Proxy = null;
            request.Method = "GET";
            request.KeepAlive = false;
            request.Timeout = HttpTimeoutMs;
            request.ReadWriteTimeout = HttpTimeoutMs;

            try
            {
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    // The body is an ack, not data this helper needs. Disposing
                    // the response is what releases the connection.
                    return true;
                }
            }
            catch (WebException error)
            {
                if (error.Response != null)
                {
                    error.Response.Close();
                    return true;
                }
                Log("http error " + error.Message);
                return false;
            }
        }
        catch (Exception error)
        {
            // A helper that throws here would leave the click half done, so every
            // failure is reported as "not delivered" rather than propagated.
            Log("http exception " + error.Message);
            return false;
        }
    }

    /// <summary>
    /// The desktop application's primary window, or IntPtr.Zero.
    /// </summary>
    /// <remarks>
    /// Several DeepSeek Harness windows exist at once: Chromium's hidden GPU and
    /// message windows, the IME windows, and the real top-level window. The
    /// filter accepts only a titled window of the target process on a plausible
    /// class, and scores the survivors so the visible Chrome_WidgetWin_1 window
    /// with the longest title wins even when a hidden sibling is enumerated too.
    /// </remarks>
    /// <returns>The best matching window handle.</returns>
    private static IntPtr FindWindow()
    {
        IntPtr best = IntPtr.Zero;
        int bestScore = int.MinValue;
        Dictionary<uint, bool> processCache = new Dictionary<uint, bool>();

        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (GetWindowTextLength(hwnd) <= 0) return true;

            string className = ClassOf(hwnd);
            if (className == "IME" || className == "MSCTFIME UI" || className == "Base_PowerMessageWindow") return true;
            // Chromium creates Chrome_WidgetWin_0 for message-only windows; it is
            // never the window the user means.
            if (className.StartsWith("Chrome_WidgetWin_0", StringComparison.Ordinal)) return true;

            string title = TextOf(hwnd);
            if (title.Length == 0 || title == "Default IME" || title == "MSCTFIME UI") return true;

            uint processId;
            GetWindowThreadProcessId(hwnd, out processId);
            if (!IsTargetProcess(processId, processCache)) return true;

            int score = (IsWindowVisible(hwnd) ? 1000 : 0) +
                (className == TargetWindowClass ? 500 : 0) +
                Math.Min(title.Length, 300);
            if (score > bestScore)
            {
                bestScore = score;
                best = hwnd;
            }
            return true;
        }, IntPtr.Zero);

        return best;
    }

    /// <summary>
    /// Whether one process id belongs to the desktop application.
    /// </summary>
    /// <remarks>
    /// The answer is cached per enumeration because the process name is more
    /// expensive to fetch than the window data, and one process usually owns
    /// several of the windows being examined.
    /// </remarks>
    private static bool IsTargetProcess(uint processId, Dictionary<uint, bool> cache)
    {
        bool cached;
        if (cache.TryGetValue(processId, out cached)) return cached;

        bool match = false;
        try
        {
            match = string.Equals(Process.GetProcessById((int)processId).ProcessName, TargetProcessName, StringComparison.Ordinal);
        }
        catch
        {
            // The process ended while its windows were being enumerated.
            match = false;
        }
        cache[processId] = match;
        return match;
    }

    /// <summary>Read one window's class name.</summary>
    private static string ClassOf(IntPtr hwnd)
    {
        StringBuilder text = new StringBuilder(256);
        GetClassName(hwnd, text, text.Capacity);
        return text.ToString();
    }

    /// <summary>Read one window's title.</summary>
    private static string TextOf(IntPtr hwnd)
    {
        int length = GetWindowTextLength(hwnd);
        if (length <= 0) return "";
        StringBuilder text = new StringBuilder(length + 2);
        GetWindowText(hwnd, text, text.Capacity);
        return text.ToString();
    }

    /// <summary>
    /// Show the window only when it is minimized or hidden, then focus it.
    /// </summary>
    /// <remarks>
    /// A click must never change the placement of a window the user can already
    /// see. The only ShowWindow call allowed here is SW_RESTORE, and only for an
    /// iconic window: it returns the window to the state it had before it was
    /// minimized (maximized included). Calling SW_SHOW - which is documented as
    /// merely making a window visible - on an already-visible Chromium window was
    /// measured live to un-maximize it (1550x878 -> 1295x800), so a visible window
    /// is left completely untouched and only the foreground calls below raise it.
    ///
    /// A window closed to the tray has WS_VISIBLE cleared, which ShowWindow must
    /// not be asked to fix for the same reason. SetWindowPos with SWP_SHOWWINDOW
    /// sets the visibility bit while leaving WS_MAXIMIZE and the window rectangle
    /// alone, so a maximized window comes back maximized; only if it is also
    /// iconic is it restored. Chromium then re-hides a window whose visibility the
    /// application believes is false, so if the window is still invisible after a
    /// short settle, the application is asked to show it through its own
    /// dsh://open activation and given a moment to comply.
    ///
    /// Foregrounding is a separate problem. Windows only lets the current
    /// foreground process (or one that shares its input queue) call
    /// SetForegroundWindow successfully, so this thread attaches to the foreground
    /// thread first. The attachment is always undone, even on the failure path.
    /// </remarks>
    /// <param name="hwnd">The window to raise.</param>
    /// <returns>true when the window ended up in the foreground.</returns>
    private static bool ForceForeground(IntPtr hwnd)
    {
        // Restore only a minimized window, exactly once. Nothing else may touch a
        // window that is already visible: the click must not resize or re-place it.
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);

        if (!IsWindowVisible(hwnd))
        {
            // SWP_SHOWWINDOW is the visibility fix for a tray-hidden window: it
            // sets WS_VISIBLE without ShowWindow's placement logic, so a maximized
            // window stays maximized. A hidden window that is also iconic still
            // needs SW_RESTORE to come back to its pre-minimize state.
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);

            // The visibility bit and the paint can land one frame apart; asking
            // the application for help immediately would waste the cheap path.
            Stopwatch settle = Stopwatch.StartNew();
            while (settle.ElapsedMilliseconds < 300 && Remaining() > 0 && !IsWindowVisible(hwnd)) Thread.Sleep(20);
        }

        if (!IsWindowVisible(hwnd) && Remaining() > 0)
        {
            Log("wake dsh://open");
            ShellOpen("dsh://open");
            WaitVisible(hwnd, Math.Min(ShowFallbackWaitMs, Remaining()));
        }

        // Final settle before the foreground attempt: restore only an iconic
        // window. There is deliberately no else/show call here - a visible window
        // must be left exactly as it is, and BringWindowToTop/SetForegroundWindow
        // below need no show call to raise it.
        if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);

        IntPtr foreground = GetForegroundWindow();
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        uint currentThread = GetCurrentThreadId();
        bool attached = foregroundThread != 0 && foregroundThread != currentThread &&
            AttachThreadInput(currentThread, foregroundThread, true);

        try
        {
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);

            int limit = Math.Min(ForegroundWaitMs, Remaining());
            Stopwatch wait = Stopwatch.StartNew();
            while (wait.ElapsedMilliseconds < limit)
            {
                if (GetForegroundWindow() == hwnd) return true;
                // The foreground lock can bounce the first call; retrying while
                // still attached is what usually wins on the second attempt.
                if (wait.ElapsedMilliseconds > 200)
                {
                    BringWindowToTop(hwnd);
                    SetForegroundWindow(hwnd);
                }
                Thread.Sleep(10);
            }
            return GetForegroundWindow() == hwnd;
        }
        finally
        {
            if (attached) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }

    /// <summary>Wait until a window reports itself visible, within a bound.</summary>
    private static void WaitVisible(IntPtr hwnd, int limitMs)
    {
        Stopwatch wait = Stopwatch.StartNew();
        while (wait.ElapsedMilliseconds < limitMs)
        {
            if (IsWindowVisible(hwnd)) return;
            Thread.Sleep(50);
        }
    }

    /// <summary>Milliseconds left in the whole activation's budget.</summary>
    private static int Remaining()
    {
        int left = TotalBudgetMs - (int)Clock.ElapsedMilliseconds;
        return left < 0 ? 0 : left;
    }

    /// <summary>Activate a URL through the shell, as Explorer would.</summary>
    /// <remarks>
    /// Failures are swallowed on purpose: this is the last resort, and there is no
    /// window left to report to. The diagnostic log is the only recipient.
    /// </remarks>
    private static void ShellOpen(string target)
    {
        try
        {
            ProcessStartInfo info = new ProcessStartInfo();
            info.FileName = target;
            info.UseShellExecute = true;
            Process.Start(info);
        }
        catch (Exception error)
        {
            Log("shellopen fail " + error.Message);
        }
    }

    /// <summary>
    /// Append one timestamped diagnostic line when DSH_NOTICE_CLICK_LOG is set.
    /// </summary>
    /// <remarks>
    /// Diagnostics are opt-in and best effort. A click must behave exactly the
    /// same when the log cannot be written, so every failure is ignored here.
    /// </remarks>
    private static void Log(string message)
    {
        if (logPath.Length == 0) return;
        try
        {
            string line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine;
            File.AppendAllText(logPath, line, Encoding.UTF8);
        }
        catch
        {
            // Intentionally empty: logging must never change the click outcome.
        }
    }
}
