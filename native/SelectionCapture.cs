using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Text;

namespace WordLens.Native {
  public sealed class SelectedText {
    public string Text;
    public double X, Y;
    public long Window;
  }
  public static class SelectionCapture {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out NativePoint point);
    [StructLayout(LayoutKind.Sequential)] public struct NativePoint { public int X, Y; }
    public static NativePoint Cursor() { NativePoint point; GetCursorPos(out point); return point; }
    public static bool IsDocumentApp(IntPtr window) {
      uint id; GetWindowThreadProcessId(window, out id);
      try {
        using (var process = Process.GetProcessById((int)id)) {
          string name = process.ProcessName.ToLowerInvariant();
          return name == "msedge" || name == "chrome" || name == "powerpnt" || name == "wpp";
        }
      } catch { return false; }
    }
    static bool Sensitive(AutomationElement element) {
      try { return element.Current.IsPassword || element.Current.ControlType == ControlType.Edit || element.Current.ControlType == ControlType.ComboBox; }
      catch { return true; }
    }
    static bool ExpectedDocument(AutomationElement start, string expected) {
      if (expected == null) return true;
      for (int i = 0; start != null && i < 16; i++, start = TreeWalker.RawViewWalker.GetParent(start))
        if (start.Current.ControlType == ControlType.Document && (start.Current.Name ?? "").IndexOf(expected, StringComparison.OrdinalIgnoreCase) >= 0) return true;
      return false;
    }
    static SelectedText Read(AutomationElement start, IntPtr window, HashSet<string> seen, string expected) {
      if (!ExpectedDocument(start, expected)) return null;
      AutomationElement element = start;
      for (int depth = 0; element != null && depth < 14; depth++) {
        if (Sensitive(element)) return null;
        string key = String.Join("-", element.GetRuntimeId());
        if (seen.Add(key)) {
          object raw;
          if (element.TryGetCurrentPattern(TextPattern.Pattern, out raw)) {
            var pattern = (TextPattern)raw;
            if (pattern.SupportedTextSelection != SupportedTextSelection.None) {
              var ranges = pattern.GetSelection();
              var builder = new StringBuilder(); double x = 0, y = 0;
              foreach (var range in ranges) {
                if (range.CompareEndpoints(TextPatternRangeEndpoint.Start, range, TextPatternRangeEndpoint.End) == 0) continue;
                string text = range.GetText(2001);
                if (builder.Length + text.Length > 2000) return null;
                builder.Append(text);
                Rect[] rectangles = range.GetBoundingRectangles();
                if (rectangles.Length > 0) { x = rectangles[0].Left; y = rectangles[0].Bottom; }
              }
              string selection = builder.ToString().Trim();
              if (selection.Length > 0 && GetForegroundWindow() == window)
                return new SelectedText { Text = selection, X = x, Y = y, Window = window.ToInt64() };
            }
          }
        }
        element = TreeWalker.RawViewWalker.GetParent(element);
      }
      return null;
    }
    // Reads the selected ranges only. Never reads the document, clipboard, keyboard text, screenshots or files.
    public static SelectedText Capture(IntPtr expected, string documentName = null) {
      if (GetForegroundWindow() != expected || !IsDocumentApp(expected)) return null;
      var seen = new HashSet<string>();
      AutomationElement focus = AutomationElement.FocusedElement;
      if (focus != null && Sensitive(focus)) return null;
      SelectedText selected = null;
      try { if (focus != null) selected = Read(focus, expected, seen, documentName); } catch { }
      if (selected != null) return selected;
      var mouse = Cursor();
      try { return Read(AutomationElement.FromPoint(new Point(mouse.X, mouse.Y)), expected, seen, documentName); } catch { return null; }
    }
  }
}
