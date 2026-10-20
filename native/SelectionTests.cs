using System;
using System.Collections.Generic;
using System.Windows;

namespace WordLens.Native {
  static class SelectionTests {
    sealed class Node : SelectionNode {
      readonly string id = Guid.NewGuid().ToString("N");
      public Node Owner;
      public readonly List<SelectionNode> Items = new List<SelectionNode>();
      public bool IsDocument, IsContainer, Edit, ReadOnly, Provider, Broken, Outside;
      public bool Password = false;
      public string Text;
      public Rect[] Bounds = new[] { new Rect(110,230,60,20) };
      public bool? ContainsCaret = true;
      public int Reads;
      public override string Id { get { return id; } }
      public override bool Blocked { get { return SelectionSearch.IsBlocked(Password, Edit, false, ReadOnly); } }
      public override bool Document { get { return IsDocument; } }
      public override bool Container { get { return IsContainer; } }
      public override bool AtPoint(SelectionCapture.NativePoint point) { return !Outside && point.X == 120 && point.Y == 240; }
      public override SelectionNode Parent { get { return Owner; } }
      public override IEnumerable<SelectionNode> Children() { return Items; }
      public Node Add(Node child) { child.Owner = this; Items.Add(child); return child; }
      public override SelectedText Read(CaptureResult result) {
        Reads++;
        if (Blocked) throw new Exception("Sensitive node read");
        if (Broken) throw new Exception("Disconnected provider");
        if (!Provider) return null;
        result.Providers++;
        return Text == null ? null : new SelectedText { Text = Text, SelectionBounds = Bounds, PointWithinRange = ContainsCaret };
      }
    }
    static readonly SelectionCapture.NativePoint Anchor = new SelectionCapture.NativePoint { X = 120, Y = 240 };
    static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    public static string[] Run() {
      var passed = new List<string>();
      Check(!SelectionSearch.IsBlocked(false, true, false, true) && SelectionSearch.IsBlocked(false, true, false, false)
        && SelectionSearch.IsBlocked(true, true, false, true) && SelectionSearch.IsBlocked(false, false, true, true), "Read-only edit policy");
      passed.Add("read-only-pdf-and-sensitive-edit-policy");

      var document = new Node { IsDocument = true };
      var layer = document.Add(new Node { IsContainer = true });
      var pdf = layer.Add(new Node { Edit = true, ReadOnly = true, Provider = true, Text = "Basic" });
      var result = SelectionSearch.Find(document, null, Anchor);
      Check(result.Selection != null && result.Selection.Text == "Basic" && pdf.Reads == 1, "Nested read-only PDF provider");
      passed.Add("nested-pdf-text-provider");

      var stale = new Node { IsDocument = true, Provider = true, Text = "previous word", Bounds = new[] { new Rect(400,400,100,25) } };
      stale.Add(new Node { Provider = true, Text = "current word" });
      result = SelectionSearch.Find(stale, null, Anchor);
      Check(result.Selection != null && result.Selection.Text == "current word" && result.Rejected == 1, "Stale ancestor selection replaced current word");
      passed.Add("stale-ancestor-selection-rejected");

      var wrongCaret = new Node { IsDocument = true, Provider = true, Text = "unrelated", ContainsCaret = false };
      result = SelectionSearch.Find(wrongCaret, null, Anchor);
      Check(result.Selection == null && result.Reason == "selection-mismatch", "Caret outside selected range accepted");
      passed.Add("point-range-must-match-selection");

      Check(SelectionGeometry.Matches(new[] {new Rect(20,100,100,20),new Rect(110,230,60,20)},true,Anchor)
        && !SelectionGeometry.Matches(new Rect[0],true,Anchor), "Wrapped or invisible selection geometry");
      passed.Add("wrapped-selection-uses-all-visible-rectangles");

      var sensitive = new Node { Edit = true, Provider = true, Text = "private input" };
      var sensitiveChild = sensitive.Add(new Node { Provider = true, Text = "private input" });
      result = SelectionSearch.Find(sensitiveChild, sensitive, Anchor);
      Check(result.Selection == null && sensitive.Reads == 0 && sensitiveChild.Reads == 0 && result.Reason == "protected", "Editable ancestor protection");
      passed.Add("editable-ancestor-never-read");

      var wrapper = new Node { IsDocument = true };
      wrapper.Add(new Node { Broken = true });
      wrapper.Add(new Node { Outside = true, Provider = true, Text = "other page" });
      var live = wrapper.Add(new Node { Provider = true, Text = "take care of" });
      result = SelectionSearch.Find(wrapper, sensitive, Anchor);
      Check(result.Selection != null && result.Selection.Text == "take care of" && live.Reads == 1, "Provider failure isolation");
      passed.Add("provider-error-and-other-page-isolation");

      var collapsed = new Node { IsDocument = true, Provider = true };
      result = SelectionSearch.Find(collapsed, collapsed, Anchor);
      Check(result.Selection == null && result.Reason == "no-selection" && collapsed.Reads == 1, "Collapsed selection must stay empty");
      passed.Add("collapsed-selection-does-not-read-document");

      var window = new Node(); var other = window.Add(new Node { IsDocument = true, Provider = true, Text = "other tab" });
      result = SelectionSearch.Find(window, null, Anchor);
      Check(result.Selection == null && other.Reads == 0, "Window-wide search forbidden");
      passed.Add("no-browser-window-wide-search");

      var large = new Node { IsDocument = true };
      for (int i = 0; i < 500; i++) large.Add(new Node());
      result = SelectionSearch.Find(large, null, Anchor);
      Check(result.Nodes <= 240 && result.Reason == "search-limit", "Bounded search");
      passed.Add("bounded-provider-search");

      Check(SelectionTiming.Retry("no-selection", 1) && SelectionTiming.Retry("no-selection", 2) && !SelectionTiming.Retry("no-selection", 3)
        && SelectionTiming.Retry("selection-mismatch", 4) && !SelectionTiming.Retry("selection-mismatch", 5)
        && !SelectionTiming.Retry("foreground", 1) && !SelectionTiming.Retry("too-long", 1), "Retry limits");
      passed.Add("transient-selection-retry-limits");

      var snapshot = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(NativeStatus.Snapshot("no-selection", "no-provider", "auto", 3, 5, 0));
      Check(snapshot.IndexOf("text", StringComparison.OrdinalIgnoreCase) < 0 && snapshot.IndexOf("window", StringComparison.OrdinalIgnoreCase) < 0
        && snapshot.IndexOf("path", StringComparison.OrdinalIgnoreCase) < 0 && snapshot.IndexOf("url", StringComparison.OrdinalIgnoreCase) < 0, "Content-free diagnostic");
      passed.Add("content-free-health-snapshot");
      return passed.ToArray();
    }
  }
}
