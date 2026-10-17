using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace WordLens.Native {
  static class NativeStatus {
    // A single overwritten health snapshot, never selection/document/URL/window data.
    public static object Snapshot(string state, string reason, string mode, int attempt, int nodes, int providers) {
      return new { type = "capture-status", version = "1.3.1", state = state, reason = reason, mode = mode,
        attempt = attempt, nodes = nodes, providers = providers, updatedUtc = DateTime.UtcNow.ToString("o") };
    }
    public static void Write(object snapshot) {
      try {
        Directory.CreateDirectory(Installer.DirectoryPath);
        File.WriteAllText(Path.Combine(Installer.DirectoryPath, "native-status.json"), new JavaScriptSerializer().Serialize(snapshot), new UTF8Encoding(false));
      } catch { }
    }
  }
  static class SelectionTiming {
    public static bool Retry(string reason, int attempt) {
      return attempt < 3 && reason != "foreground" && reason != "too-long";
    }
  }
}
