using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: AssemblyTitle("WordLens 原页面划词辅助")]
[assembly: AssemblyVersion("1.3.0.0")]

namespace WordLens.Native {
  static class Program {
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [STAThread] static int Main(string[] args) {
      SetProcessDPIAware(); Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
      if (args.Length == 1 && args[0] == "--self-test") return SelfTests.Run();
      if (args.Length == 2 && args[0] == "--install-user") {
        try { Installer.Install(args[1]); Protocol.Write(Console.OpenStandardOutput(), new { type = "installed", version = "1.3.0", scope = "current-user" }); return 0; }
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
    readonly Stream output = Console.OpenStandardOutput();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 70 };
    readonly Popup popup;
    readonly bool diagnostic;
    string mode = "context", trigger = "selection", request = "";
    bool busy, pending, captureManual, alive = true;
    MouseHook hookCallback;
    IntPtr mouseHook;
    long generation;
    DateTime captureAt;
    IntPtr captureWindow;
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
        Send(new { type = "ready", version = "1.3.0", selectedTextOnly = true, clipboard = false, automatic = mouseHook != IntPtr.Zero });
      }));
      FormClosed += delegate { alive = false; timer.Stop(); if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook); popup.Dispose(); };
    }
    protected override void SetVisibleCore(bool value) { base.SetVisibleCore(false); }
    void ClearSelection(bool notify) {
      generation++; pending = false; request = ""; popup.Hide();
      if (notify) Send(new { type = "dismissed" });
    }
    IntPtr MouseInput(int code, IntPtr message, IntPtr data) {
      int kind = message.ToInt32();
      if (code >= 0 && (kind == 0x201 || kind == 0x202 || kind == 0x20a)) {
        try { BeginInvoke((Action)(() => {
          var cursor = SelectionCapture.Cursor();
          if (popup.Visible && popup.Bounds.Contains(cursor.X, cursor.Y)) return;
          if (kind == 0x201 || kind == 0x20a) ClearSelection(true);
          if (kind == 0x202 && mode == "auto") Schedule(false);
        })); } catch { }
      }
      return CallNextHookEx(mouseHook, code, message, data);
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
      string type = StringValue(message, "type");
      if (type == "configure") {
        string next = StringValue(message, "mode"); mode = next == "auto" || next == "shortcut" ? next : "context";
        trigger = StringValue(message, "trigger") == "alt" ? "alt" : "selection";
        ClearSelection(false);
        Send(new { type = "configured", mode = mode });
      } else if (type == "capture") Schedule(true);
      else if (type == "dismiss") ClearSelection(false);
      else if (type == "result" && StringValue(message, "requestId") == request) popup.Render(message);
      else if (type == "speech-status" && StringValue(message, "requestId") == request) popup.Note(StringValue(message, "message"));
    }
    void Schedule(bool manual) {
      var window = SelectionCapture.GetForegroundWindow();
      if (!SelectionCapture.IsDocumentApp(window)) { if (manual) Send(new { type = "capture-empty", reason = "foreground" }); return; }
      if (!manual && trigger == "alt" && SelectionCapture.GetAsyncKeyState(0x12) >= 0) return;
      generation++; captureWindow = window; captureManual = manual; captureAt = DateTime.UtcNow.AddMilliseconds(manual ? 20 : 130); pending = true;
    }
    void Tick(object sender, EventArgs e) {
      if (!alive) { Close(); return; }
      var point = SelectionCapture.Cursor(); bool inside = popup.Visible && popup.Bounds.Contains(point.X, point.Y);
      if (popup.Visible && (SelectionCapture.GetAsyncKeyState(0x1b) != 0 || (!inside && SelectionCapture.GetForegroundWindow() != captureWindow))) ClearSelection(true);
      if (!pending || busy || DateTime.UtcNow < captureAt) return;
      pending = false; busy = true;
      long ticket = generation; IntPtr window = captureWindow; bool manual = captureManual;
      Task.Run(() => { try { return SelectionCapture.Capture(window, diagnostic ? "reading.pdf" : null); } catch { return null; } }).ContinueWith(task => {
        try { BeginInvoke((Action)(() => {
          busy = false;
          if (!alive || ticket != generation || SelectionCapture.GetForegroundWindow() != window) return;
          var selected = task.Result;
          if (selected == null) {
            if (!manual) return;
            request = Guid.NewGuid().ToString("N"); popup.Prepare(request, new SelectedText { Text = "当前选区" });
            Send(new { type = "capture-empty", reason = "no-selection", requestId = request }); return;
          }
          request = Guid.NewGuid().ToString("N");
          popup.Prepare(request, selected);
          Send(new { type = "selection", requestId = request, text = selected.Text, sourceWindow = selected.Window });
        })); } catch { }
      });
    }
  }
  sealed class Popup : Form {
    readonly Action<object> send;
    readonly Label heading, phonetic, source;
    readonly TextBox definitions;
    readonly Button speak;
    string request = "";
    public Popup(Action<object> sender, Action closeRequested) {
      send = sender; TopMost = true; ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.FixedSingle;
      BackColor = Color.FromArgb(255, 254, 251); ForeColor = Color.FromArgb(38, 61, 53); Size = new Size(380, 320); StartPosition = FormStartPosition.Manual;
      Font = new Font("Microsoft YaHei UI", 10); Text = "WordLens 原页面查词"; AccessibleName = Text;
      var brand = new Label { Text = "WORDLENS  ·  原页面", ForeColor = Color.FromArgb(100, 130, 116), Location = new Point(18, 12), Size = new Size(270, 22), Font = new Font("Segoe UI", 9, FontStyle.Bold) };
      var close = new Button { Text = "×", Location = new Point(332, 8), Size = new Size(28, 28), FlatStyle = FlatStyle.Flat, AccessibleName = "关闭释义", TabStop = false }; close.FlatAppearance.BorderSize = 0; close.Click += delegate { closeRequested(); };
      heading = new Label { Location = new Point(18, 43), Size = new Size(340, 62), Font = new Font("Georgia", 19), AutoEllipsis = true, UseMnemonic = false };
      phonetic = new Label { Location = new Point(18, 109), Size = new Size(250, 30), Font = new Font("Segoe UI", 11), ForeColor = Color.FromArgb(106, 119, 106), UseMnemonic = false };
      speak = new Button { Text = "听发音", Location = new Point(280, 108), Size = new Size(78, 28), FlatStyle = FlatStyle.Flat, TabStop = false }; speak.FlatAppearance.BorderColor = Color.FromArgb(220, 229, 209); speak.Click += delegate { speak.Enabled = false; source.Text = "正在调用本地英语语音…"; send(new { type = "speak", requestId = request }); };
      definitions = new TextBox { Location = new Point(18, 149), Size = new Size(340, 103), BorderStyle = BorderStyle.None, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = BackColor, ForeColor = ForeColor, TabStop = false, AccessibleName = "中文释义或翻译" };
      source = new Label { Location = new Point(18, 261), Size = new Size(340, 40), Font = new Font("Microsoft YaHei UI", 8), ForeColor = Color.FromArgb(116, 128, 110), UseMnemonic = false };
      Controls.AddRange(new Control[] { brand, close, heading, phonetic, speak, definitions, source });
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080; return p; } }
    protected override void WndProc(ref System.Windows.Forms.Message m) { if (m.Msg == 0x21) { m.Result = new IntPtr(3); return; } base.WndProc(ref m); }
    public void Prepare(string id, SelectedText selected) {
      request = id; heading.Text = selected.Text; phonetic.Text = "正在查询…"; definitions.Text = "正在读取词典…"; speak.Enabled = false;
      var cursor = SelectionCapture.Cursor(); var area = Screen.FromPoint(new Point(cursor.X, cursor.Y)).WorkingArea;
      int left = (int)(selected.X == 0 ? cursor.X : selected.X), top = (int)(selected.Y == 0 ? cursor.Y : selected.Y) + 12;
      if (top + Height > area.Bottom - 10) top = cursor.Y - Height - 14;
      Location = new Point(Math.Max(area.Left + 10, Math.Min(left, area.Right - Width - 10)), Math.Max(area.Top + 10, Math.Min(top, area.Bottom - Height - 10)));
      // Wait for the extension to validate the English text before displaying anything.
    }
    public void Render(Dictionary<string, object> message) {
      object raw; var result = message.TryGetValue("result", out raw) ? raw as Dictionary<string, object> : null;
      if (result == null) return;
      string status = Value(result, "status"), word = Value(result, "word");
      speak.Enabled = status == "ok";
      if (status == "ok") {
        heading.Text = word; phonetic.Text = Value(result, "displayPhonetic");
        var lines = new List<string>();
        if (result.TryGetValue("definitions", out raw) && raw is IEnumerable) foreach (object line in (IEnumerable)raw) if (line is string) lines.Add((string)line);
        definitions.Text = String.Join(Environment.NewLine + Environment.NewLine, lines);
        source.Text = Value(result, "translation") == "True" ? "MyMemory 机器翻译 · 仅发送选中文字 · Esc 关闭" : "ECDICT 离线词典 · 保留原页面 · Esc 关闭";
      } else { phonetic.Text = "—"; definitions.Text = status == "not-found" ? "词典暂未收录这个单词，可以试试原形。" : Value(result, "message"); source.Text = "WordLens · 原文档保持不变 · Esc 关闭"; }
      Show();
    }
    static string Value(Dictionary<string, object> value, string key) { object raw; return value.TryGetValue(key, out raw) && raw != null ? raw.ToString() : ""; }
    public void Note(string text) { source.Text = text ?? ""; speak.Enabled = true; }
  }
}
