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
[assembly: AssemblyVersion("1.3.9.0")]

namespace WordLens.Native {
  static class Program {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] static int Main(string[] args) {
      SetProcessDPIAware(); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
      if (args.Length == 2 && args[0] == "--render-preview") return PopupPreview.Run(args[1]);
      if (args.Length == 2 && args[0] == "--install-user") {
        try { Installer.Install(args[1]); Protocol.Write(Console.OpenStandardOutput(), new { type = "installed", version = "1.3.9", scope = "current-user" }); return 0; }
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
    IntPtr keyboardHook;
    MouseHook keyboardCallback;
    readonly CopyGate copyGate = new CopyGate();
    readonly SelectionGesture gesture = new SelectionGesture(SystemInformation.DragSize.Width / 2,
      SystemInformation.DragSize.Height / 2, SystemInformation.DoubleClickSize.Width / 2,
      SystemInformation.DoubleClickSize.Height / 2, (uint)SystemInformation.DoubleClickTime);
    bool copyPending, copyListening;
    uint copySequence;
    DateTime copyDeadline;
    long generation;
    DateTime captureAt;
    IntPtr captureWindow;
    SelectionCapture.NativePoint capturePoint;
    int attempts;
    DateTime busySince;
    DateTime hookChecked;
    bool slowReported;
    public Host(bool diagnosticMode) {
      diagnostic = diagnosticMode;
      ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.FixedToolWindow; Opacity = 0; Size = new Size(1, 1);
      popup = new Popup(Send, () => ClearSelection(true));
      var handle = Handle;
      BeginInvoke((Action)(() => {
        Hide(); timer.Tick += Tick; timer.Start();
        hookCallback = MouseInput; keyboardCallback = KeyboardInput;
        RefreshHook();
        new Thread(ReadLoop) { IsBackground = true, Name = "WordLens native input" }.Start();
        Send(new { type = "ready", version = "1.3.9", selectedTextOnly = true, clipboard = "copy-mode-only", automatic = mouseHook != IntPtr.Zero });
        Report("ready", mouseHook == IntPtr.Zero ? "hook-unavailable" : "", null);
      }));
      FormClosed += delegate { alive = false; timer.Stop(); if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook); if (keyboardHook!=IntPtr.Zero) UnhookWindowsHookEx(keyboardHook); if (copyListening) CopySelection.RemoveClipboardFormatListener(Handle); popup.Dispose(); if (!diagnostic) NativeStatus.Write(NativeStatus.Snapshot("disconnected", "", mode, 0, 0, 0)); };
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    void ClearSelection(bool notify) {
      bool hadSelection = pending || busy || request != "" || popup.Visible;
      generation++; pending = false; copyPending=false; copyGate.Clear(); request = ""; if (!popup.IsDisposed) popup.Hide();
      if (notify && hadSelection) Send(new { type = "dismissed" });
    }
    void RefreshHook() {
      if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
      mouseHook = SetWindowsHookEx(14, hookCallback, GetModuleHandle(null), 0);
      if (keyboardHook!=IntPtr.Zero) { UnhookWindowsHookEx(keyboardHook); keyboardHook=IntPtr.Zero; }
      if (mode=="copy") keyboardHook=SetWindowsHookEx(13,keyboardCallback,GetModuleHandle(null),0);
      hookChecked = DateTime.UtcNow;
    }
    IntPtr KeyboardInput(int code, IntPtr message, IntPtr data) {
      if (code>=0 && mode=="copy" && message.ToInt32()==0x100 && Marshal.ReadInt32(data)==0x43 && (Marshal.ReadInt32(data,8)&0x10)==0 && SelectionCapture.GetAsyncKeyState(0x11)<0) {
        var window=SelectionCapture.GetForegroundWindow();
        if (SelectionCapture.IsDocumentApp(window)) {
          ClearSelection(false); BeginInvoke((Action)(()=>Send(new {type="dismissed"}))); captureWindow=window; capturePoint=SelectionCapture.Cursor();
          copyGate.Arm(window,CopySelection.GetClipboardSequenceNumber(),DateTime.UtcNow);
        }
      }
      return CallNextHookEx(keyboardHook,code,message,data);
    }
    protected override void WndProc(ref System.Windows.Forms.Message message) {
      if (message.Msg==0x31d && mode=="copy") {
        uint sequence=CopySelection.GetClipboardSequenceNumber();
        var window=SelectionCapture.GetForegroundWindow();
        if (copyGate.Accept(window,sequence,CopySelection.OwnedBy(window),DateTime.UtcNow)) {
          copySequence=sequence; copyPending=true; copyDeadline=DateTime.UtcNow.AddMilliseconds(500);
        }
      }
      base.WndProc(ref message);
    }
    IntPtr MouseInput(int code, IntPtr message, IntPtr data) {
      int kind = message.ToInt32();
      if (code >= 0 && (kind == 0x201 || kind == 0x202 || kind == 0x20a)) {
        // Copy hook data before returning: the OS owns the pointer, and the cursor
        // may already be over Edge's floating selection toolbar when we read UIA.
        var mouse = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
        var point = mouse.Point;
        var window = SelectionCapture.GetForegroundWindow();
        bool insidePopup = !popup.IsDisposed && popup.Visible && popup.Bounds.Contains(point.X, point.Y);
        if (kind == 0x201) gesture.Press(window, point, insidePopup);
        if (kind == 0x20a) gesture.Reset();
        bool selected = kind == 0x202 && gesture.Release(window, point, mouse.Time, insidePopup);
        try { BeginInvoke((Action)(() => {
          if (insidePopup) return;
          if (kind == 0x201 || kind == 0x20a) ClearSelection(true);
          if (selected && mode == "auto") Schedule(false, window, point);
        })); } catch { }
      }
      return CallNextHookEx(mouseHook, code, message, data);
    }
    void Report(string state, string reason, CaptureResult result) {
      var snapshot = NativeStatus.Snapshot(state, reason, mode, attempts, result == null ? 0 : result.Nodes, result == null ? 0 : result.Providers);
      if (!diagnostic) NativeStatus.Write(snapshot); Send(snapshot);
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
        gesture.Reset();
        string next = StringValue(message, "mode"); mode = next == "auto" || next == "shortcut" || next=="copy" ? next : "context";
        trigger = StringValue(message, "trigger") == "alt" ? "alt" : "selection";
        ClearSelection(false);
        if (copyListening) { CopySelection.RemoveClipboardFormatListener(Handle); copyListening=false; }
        if (mode=="copy") copyListening=CopySelection.AddClipboardFormatListener(Handle);
        RefreshHook();
        Send(new { type = "configured", mode = mode, copyAvailable=copyListening && keyboardHook!=IntPtr.Zero });
        Report("configured", "", null);
      } else if (type == "capture") { if (mode=="copy") Report("no-selection","copy-required",null); else Schedule(true); }
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
      if (copyPending) {
        if (SelectionCapture.GetForegroundWindow()!=captureWindow || CopySelection.GetClipboardSequenceNumber()!=copySequence) copyPending=false;
        else {
          string text; string reason=CopySelection.Read(Handle,out text);
          if (reason!="busy" || DateTime.UtcNow>=copyDeadline) {
            copyPending=false;
            if (reason=="selected") ShowSelected(new SelectedText {Text=text,X=capturePoint.X,Y=capturePoint.Y,Window=captureWindow.ToInt64()},null);
            else Report("no-selection",reason=="busy" ? "copy-busy" : reason,null);
          }
        }
      }
      // Windows may silently remove a slow low-level hook. Renew it on the UI thread.
      if ((DateTime.UtcNow - hookChecked).TotalSeconds >= 20) RefreshHook();
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
          ShowSelected(selected,captured);
        })); } catch { }
      });
    }
    void ShowSelected(SelectedText selected,CaptureResult captured) {
      request=Guid.NewGuid().ToString("N"); popup.Prepare(request,selected);
      Report("selected","",captured);
      Send(new {type="selection",requestId=request,text=selected.Text,sourceWindow=selected.Window});
    }
  }
}
