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
  sealed class CaptureResult {
    public SelectedText Selection;
    public string Reason = "no-provider";
    public int Nodes, Providers;
  }
  // The search policy is shared by the real UIA adapter and synthetic provider tests.
  abstract class SelectionNode {
    public abstract string Id { get; }
    public abstract bool Blocked { get; }
    public abstract bool Document { get; }
    public abstract bool Container { get; }
    public abstract bool AtPoint(SelectionCapture.NativePoint point);
    public abstract SelectionNode Parent { get; }
    public abstract IEnumerable<SelectionNode> Children();
    public abstract SelectedText Read(CaptureResult result);
  }
  static class SelectionSearch {
    public static bool IsBlocked(bool password, bool edit, bool combo, bool readOnly) {
      return password || combo || (edit && !readOnly);
    }
    public static CaptureResult Find(SelectionNode point, SelectionNode focus, SelectionCapture.NativePoint anchor) {
      var result = new CaptureResult(); var seen = new HashSet<string>(); var clock = Stopwatch.StartNew();
      bool blocked = false, failed = false;
      foreach (var start in new[] { point, focus }) {
        if (start == null) continue;
        var path = new List<SelectionNode>(); bool safe = true;
        try {
          for (var node = start; node != null && path.Count < 24; node = node.Parent) {
            if (node.Blocked) { blocked = true; safe = false; break; }
            path.Add(node);
          }
        } catch { failed = true; safe = false; }
        if (!safe) continue;
        foreach (var node in path) {
          try { if (Probe(node, seen, result) || result.Reason == "too-long") return result; } catch { failed = true; }
        }
        // PDF providers can be descendants of the hit/focused document wrapper.
        // Never search the whole browser window, other tabs, or desktop.
        int documents = 0; bool fallback = false;
        foreach (var scope in path) {
          bool document;
          try { document = scope.Document; if (!document && (documents > 0 || fallback || !scope.Container)) continue; }
          catch { failed = true; continue; }
          if (document) documents++; else fallback = true;
          var queue = new Queue<KeyValuePair<SelectionNode, int>>();
          queue.Enqueue(new KeyValuePair<SelectionNode, int>(scope, 0));
          var expanded = new HashSet<string>();
          while (queue.Count > 0) {
            if (result.Nodes >= 240 || clock.ElapsedMilliseconds >= 800) { result.Reason = "search-limit"; return result; }
            var item = queue.Dequeue(); var node = item.Key;
            try {
              if (!expanded.Add(node.Id) || node.Blocked || !node.AtPoint(anchor)) continue;
              if (Probe(node, seen, result) || result.Reason == "too-long") return result;
              if (item.Value >= 12) continue;
              foreach (var child in node.Children()) {
                if (queue.Count >= 240) break;
                queue.Enqueue(new KeyValuePair<SelectionNode, int>(child, item.Value + 1));
              }
            } catch { failed = true; }
          }
          if (documents >= 2) break;
        }
      }
      if (result.Reason != "too-long") result.Reason = result.Providers > 0 ? "no-selection" : blocked ? "protected" : failed ? "provider-error" : "no-provider";
      return result;
    }
    static bool Probe(SelectionNode node, HashSet<string> seen, CaptureResult result) {
      if (!seen.Add(node.Id)) return false;
      result.Nodes++;
      var selected = node.Read(result);
      if (selected == null) return false;
      result.Selection = selected; result.Reason = "selected"; return true;
    }
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
    sealed class AutomationNode : SelectionNode {
      readonly AutomationElement element, root;
      readonly IntPtr window;
      readonly string id;
      readonly NativePoint anchor;
      public AutomationNode(AutomationElement value, AutomationElement boundary, IntPtr owner, NativePoint point) {
        element = value; root = boundary; window = owner; anchor = point;
        try { id = String.Join("-", value.GetRuntimeId()); }
        catch { id = "unavailable-" + value.GetHashCode().ToString(); }
      }
      public override string Id { get { return id; } }
      public override bool Blocked {
        get {
          var current = element.Current;
          bool edit = current.ControlType == ControlType.Edit, readOnly = false;
          if (edit && !current.IsPassword) {
            object raw;
            try { if (element.TryGetCurrentPattern(ValuePattern.Pattern, out raw)) readOnly = ((ValuePattern)raw).Current.IsReadOnly; } catch { }
            try {
              if (!readOnly && element.TryGetCurrentPattern(TextPattern.Pattern, out raw))
                readOnly = Object.Equals(((TextPattern)raw).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute), true);
            } catch { }
          }
          return SelectionSearch.IsBlocked(current.IsPassword, edit, current.ControlType == ControlType.ComboBox, readOnly);
        }
      }
      public override bool Document { get { return element.Current.ControlType == ControlType.Document; } }
      public override bool Container { get { var type = element.Current.ControlType; return type == ControlType.Pane || type == ControlType.Custom || type == ControlType.Group; } }
      public override bool AtPoint(NativePoint point) {
        Rect bounds = element.Current.BoundingRectangle;
        if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) return true;
        bounds.Inflate(24, 24); return bounds.Contains(new Point(point.X, point.Y));
      }
      public override SelectionNode Parent {
        get { if (element.Equals(root)) return null; var parent = TreeWalker.RawViewWalker.GetParent(element); return parent == null ? null : new AutomationNode(parent, root, window, anchor); }
      }
      public override IEnumerable<SelectionNode> Children() {
        int count = 0;
        for (var child = TreeWalker.RawViewWalker.GetFirstChild(element); child != null && count++ < 240; child = TreeWalker.RawViewWalker.GetNextSibling(child))
          yield return new AutomationNode(child, root, window, anchor);
      }
      public override SelectedText Read(CaptureResult result) {
        object raw;
        if (!element.TryGetCurrentPattern(TextPattern.Pattern, out raw)) return null;
        var pattern = (TextPattern)raw; result.Providers++;
        if (pattern.SupportedTextSelection == SupportedTextSelection.None) return null;
        var ranges = pattern.GetSelection();
        if (ranges == null || ranges.Length > 16) return null;
        var builder = new StringBuilder(); double x = anchor.X, y = anchor.Y;
        foreach (var range in ranges) {
          if (range.CompareEndpoints(TextPatternRangeEndpoint.Start, range, TextPatternRangeEndpoint.End) == 0) continue;
          string text = range.GetText(2001) ?? "";
          if (builder.Length + text.Length > 2000) { result.Reason = "too-long"; return null; }
          builder.Append(text);
          try { Rect[] rectangles = range.GetBoundingRectangles(); if (rectangles.Length > 0) { x = rectangles[0].Left; y = rectangles[0].Bottom; } } catch { }
        }
        string selection = builder.ToString().Trim();
        if (selection.Length == 0 || GetForegroundWindow() != window) return null;
        return new SelectedText { Text = selection, X = x, Y = y, Window = window.ToInt64() };
      }
    }
    static bool InWindow(AutomationElement start, AutomationElement root, string expected) {
      bool document = expected == null;
      for (int i = 0; start != null && i < 24; i++, start = TreeWalker.RawViewWalker.GetParent(start)) {
        if (!document && start.Current.ControlType == ControlType.Document && (start.Current.Name ?? "").IndexOf(expected, StringComparison.OrdinalIgnoreCase) >= 0) document = true;
        if (start.Equals(root)) return document;
      }
      return false;
    }
    // Reads selected ranges only. DocumentRange is used only for the read-only attribute.
    // No document text, clipboard, keyboard text, screenshots or files are read.
    internal static CaptureResult Capture(IntPtr expected, NativePoint anchor, string documentName = null) {
      if (GetForegroundWindow() != expected || !IsDocumentApp(expected)) return new CaptureResult { Reason = "foreground" };
      AutomationElement root;
      try { root = AutomationElement.FromHandle(expected); } catch { return new CaptureResult { Reason = "provider-error" }; }
      SelectionNode point = null, focus = null;
      try { var element = AutomationElement.FromPoint(new Point(anchor.X, anchor.Y)); if (InWindow(element, root, documentName)) point = new AutomationNode(element, root, expected, anchor); } catch { }
      try { var element = AutomationElement.FocusedElement; if (InWindow(element, root, documentName)) focus = new AutomationNode(element, root, expected, anchor); } catch { }
      return SelectionSearch.Find(point, focus, anchor);
    }
  }
}
