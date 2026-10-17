using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("WordLens 原页面划词辅助")]
[assembly: AssemblyVersion("1.3.2.0")]

namespace WordLens.Native {
  static class Program {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] static int Main(string[] args) {
      SetProcessDPIAware(); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
      if (args.Length == 2 && args[0] == "--render-preview") return PopupPreview.Run(args[1]);
      if (args.Length == 2 && args[0] == "--install-user") {
        try { Installer.Install(args[1]); Protocol.Write(Console.OpenStandardOutput(), new { type = "installed", version = "1.3.2", scope = "current-user" }); return 0; }
        catch (Exception error) { Protocol.Write(Console.OpenStandardOutput(), new { type = "install-error", message = error.Message }); return 1; }
      }
      if (args.Length > 0 && (args[0] == "--test-host" || Installer.AllowedOrigin(args[0]))) {
        Application.Run(new Host(args[0] == "--test-host")); return 0;
      }
      if (args.Length > 0 && args[0] != "--install") return 2;
      Application.Run(new Installer(args.Length > 1 && args[0] == "--install" ? args[1] : "")); return 0;
    }
  }
  sealed class Host : Form {
    delegate IntPtr MouseHook(int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int hook, MouseHook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] static extern IntPtr GetModuleHandle(string name);
    [StructLayout(LayoutKind.Sequential)] struct MouseData {
      public SelectionCapture.NativePoint Point;
      public uint Mouse, Flags, Time;
      public UIntPtr Extra;
    }
    readonly Stream output = Console.OpenStandardOutput();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 70 };
    Popup popup;
    readonly bool diagnostic;
    string mode = "context", trigger = "selection", request = "";
    bool busy, pending, captureManual, alive = true;
    MouseHook hookCallback;
    IntPtr mouseHook;
    long generation;
    DateTime captureAt;
    IntPtr captureWindow;
    SelectionCapture.NativePoint capturePoint;
    int attempts;
    DateTime busySince;
    bool slowReported;
    public Host(bool diagnosticMode) {
      diagnostic = diagnosticMode;
      ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.FixedToolWindow; Opacity = 0; Size = new Size(1, 1);
      popup = new Popup(Send, () => ClearSelection(true));
      var handle = Handle;
      BeginInvoke((Action)(() => {
        Hide(); timer.Tick += Tick; timer.Start();
        hookCallback = MouseInput;
        mouseHook = SetWindowsHookEx(14, hookCallback, GetModuleHandle(null), 0);
        new Thread(ReadLoop) { IsBackground = true, Name = "WordLens native input" }.Start();
        Send(new { type = "ready", version = "1.3.2", selectedTextOnly = true, clipboard = false, automatic = mouseHook != IntPtr.Zero });
        Report("ready", mouseHook == IntPtr.Zero ? "hook-unavailable" : "", null);
      }));
      FormClosed += delegate { alive = false; timer.Stop(); if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook); popup.Dispose(); NativeStatus.Write(NativeStatus.Snapshot("disconnected", "", mode, 0, 0, 0)); };
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    void ClearSelection(bool notify) {
      generation++; pending = false; request = ""; if (!popup.IsDisposed) popup.Hide();
      if (notify) Send(new { type = "dismissed" });
    }
    IntPtr MouseInput(int code, IntPtr message, IntPtr data) {
      int kind = message.ToInt32();
      if (code >= 0 && (kind == 0x201 || kind == 0x202 || kind == 0x20a)) {
        // Copy hook data before returning: the OS owns the pointer, and the cursor
        // may already be over Edge's floating selection toolbar when we read UIA.
        var point = ((MouseData)Marshal.PtrToStructure(data, typeof(MouseData))).Point;
        var window = SelectionCapture.GetForegroundWindow();
        bool insidePopup = !popup.IsDisposed && popup.Visible && popup.Bounds.Contains(point.X, point.Y);
        try { BeginInvoke((Action)(() => {
          if (insidePopup) return;
          if (kind == 0x201 || kind == 0x20a) ClearSelection(true);
          if (kind == 0x202 && mode == "auto") Schedule(false, window, point);
        })); } catch { }
      }
      return CallNextHookEx(mouseHook, code, message, data);
    }
    void Report(string state, string reason, CaptureResult result) {
      var snapshot = NativeStatus.Snapshot(state, reason, mode, attempts, result == null ? 0 : result.Nodes, result == null ? 0 : result.Providers);
      NativeStatus.Write(snapshot); Send(snapshot);
    }
    void Send(object value) { if (alive) { try { Protocol.Write(output, value); } catch { alive = false; BeginInvoke((Action)(() => Close())); } } }
    static string StringValue(Dictionary<string, object> message, string key) { object value; return message.TryGetValue(key, out value) ? value as string : null; }
    void ReadLoop() {
      try {
        object value;
        while ((value = Protocol.Read(Console.OpenStandardInput())) != null) {
          var message = value as Dictionary<string, object>;
          if (message != null) BeginInvoke((Action)(() => Message(message)));
        }
      } catch { }
      try { BeginInvoke((Action)(() => Close())); } catch { }
    }
    void Message(Dictionary<string, object> message) {
      if (!alive || popup.IsDisposed) return;
      string type = StringValue(message, "type");
      if (type == "configure") {
        string next = StringValue(message, "mode"); mode = next == "auto" || next == "shortcut" ? next : "context";
        trigger = StringValue(message, "trigger") == "alt" ? "alt" : "selection";
        ClearSelection(false);
        Send(new { type = "configured", mode = mode });
        Report("configured", "", null);
      } else if (type == "capture") Schedule(true);
      else if (type == "dismiss") ClearSelection(false);
      else if (type == "result" && StringValue(message, "requestId") == request) { popup.Render(message); Report("shown", "", null); }
      else if (type == "speech-status" && StringValue(message, "requestId") == request) popup.Note(StringValue(message, "message"));
    }
    void Schedule(bool manual) {
      Schedule(manual, SelectionCapture.GetForegroundWindow(), SelectionCapture.Cursor());
    }
    void Schedule(bool manual, IntPtr window, SelectionCapture.NativePoint point) {
      if (!SelectionCapture.IsDocumentApp(window)) { if (manual) Send(new { type = "capture-empty", reason = "foreground" }); return; }
      if (!manual && trigger == "alt" && SelectionCapture.GetAsyncKeyState(0x12) >= 0) return;
      generation++; captureWindow = window; capturePoint = point; captureManual = manual; attempts = 0;
      captureAt = DateTime.UtcNow.AddMilliseconds(manual ? 20 : 130); pending = true;
    }
    void Tick(object sender, EventArgs e) {
      if (!alive) { Close(); return; }
      if (popup.IsDisposed) { generation++; pending = false; request = ""; popup = new Popup(Send, () => ClearSelection(true)); }
      var point = SelectionCapture.Cursor(); bool inside = popup.Visible && popup.Bounds.Contains(point.X, point.Y);
      bool escape = SelectionCapture.GetAsyncKeyState(0x1b) != 0;
      if ((escape && (popup.Visible || pending || busy || request != "")) || (popup.Visible && !inside && SelectionCapture.GetForegroundWindow() != captureWindow)) ClearSelection(true);
      if (busy && !slowReported && (DateTime.UtcNow - busySince).TotalSeconds >= 4) { slowReported = true; Report("no-selection", "provider-timeout", null); }
      if (!pending || busy || DateTime.UtcNow < captureAt) return;
      pending = false; busy = true; busySince = DateTime.UtcNow; slowReported = false; attempts++;
      long ticket = generation; IntPtr window = captureWindow; bool manual = captureManual;
      var anchor = capturePoint;
      Task.Run(() => { try { return SelectionCapture.Capture(window, anchor, diagnostic ? "reading.pdf" : null); } catch { return new CaptureResult { Reason = "provider-error" }; } }).ContinueWith(task => {
        try { BeginInvoke((Action)(() => {
          busy = false;
          if (!alive || popup.IsDisposed || ticket != generation || SelectionCapture.GetForegroundWindow() != window) return;
          var captured = task.Result; var selected = captured.Selection;
          if (selected == null) {
            if (SelectionTiming.Retry(captured.Reason, attempts)) { captureAt = DateTime.UtcNow.AddMilliseconds(attempts * 140); pending = true; return; }
            Report("no-selection", captured.Reason, captured);
            if (!manual) return;
            request = Guid.NewGuid().ToString("N"); popup.Prepare(request, new SelectedText { Text = "当前选区" });
            Send(new { type = "capture-empty", reason = "no-selection", requestId = request }); return;
          }
          request = Guid.NewGuid().ToString("N");
          popup.Prepare(request, selected);
          Report("selected", "", captured);
          Send(new { type = "selection", requestId = request, text = selected.Text, sourceWindow = selected.Window });
        })); } catch { }
      });
    }
  }
}
