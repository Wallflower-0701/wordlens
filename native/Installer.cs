using System;
using System.IO;
using System.Linq;
using System.Drawing;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace WordLens.Native {
  sealed class Installer : Form {
    public const string HostName = "com.wordlens.selection";
    readonly TextBox extensionId;
    readonly Label status;
    public Installer(string id) {
      Text = "WordLens 原页面增强 · 安装 / 卸载"; Size = new Size(540, 410); StartPosition = FormStartPosition.CenterScreen;
      Font = new Font("Microsoft YaHei UI", 10); BackColor = Color.FromArgb(250, 251, 245); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false;
      var title = new Label { Text = "在原来的 PDF / PPT 页面查词", Location = new Point(25, 22), Size = new Size(480, 36), Font = new Font(Font, FontStyle.Bold) };
      var description = new Label { Text = "仅在插件启用后读取 Edge、Chrome、PowerPoint 或 WPS 的当前选区。\n不读取整份文档，不使用剪贴板，不记录输入，不随 Windows 开机启动。\n安装仅注册当前用户的浏览器通信组件，无需管理员权限。", Location = new Point(25, 70), Size = new Size(480, 85) };
      var label = new Label { Text = "粘贴插件面板中显示的扩展 ID（32 个字母）：", Location = new Point(25, 165), Size = new Size(470, 25) };
      extensionId = new TextBox { Text = id, Location = new Point(25, 195), Size = new Size(470, 28), AccessibleName = "WordLens 扩展 ID" };
      var install = new Button { Text = "安装 / 更新", Location = new Point(25, 244), Size = new Size(140, 35) }; install.Click += delegate { try { Install(extensionId.Text.Trim()); status.Text = "安装完成。请在 Edge 重新加载 WordLens，并启用“原页面增强”。"; } catch (Exception e) { status.Text = e.Message; } };
      var uninstall = new Button { Text = "卸载注册", Location = new Point(185, 244), Size = new Size(140, 35) }; uninstall.Click += delegate { try { Unregister(); status.Text = "已移除浏览器通信注册。辅助程序不再由插件启动。"; } catch (Exception e) { status.Text = e.Message; } };
      status = new Label { Location = new Point(25, 295), Size = new Size(470, 65), ForeColor = Color.FromArgb(71, 102, 74) };
      Controls.AddRange(new Control[] { title, description, label, extensionId, install, uninstall, status });
    }
    public static string DirectoryPath { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WordLens"); } }
    public static bool AllowedOrigin(string origin) {
      if (!Regex.IsMatch(origin ?? "", @"^chrome-extension://[a-p]{32}/?$")) return false;
      try {
        return OriginInManifest(origin, File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, HostName + ".json")));
      } catch { return false; }
    }
    public static bool OriginInManifest(string origin, string json) {
      if (!Regex.IsMatch(origin ?? "", @"^chrome-extension://[a-p]{32}/?$")) return false;
      var config = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(json);
      if (!String.Equals(config["name"] as string, HostName, StringComparison.Ordinal)) return false;
      return ((object[])config["allowed_origins"]).Cast<string>().Any(value => value.TrimEnd('/') == origin.TrimEnd('/'));
    }
    public static void Install(string id) {
      if (!Regex.IsMatch(id ?? "", "^[a-p]{32}$")) throw new InvalidOperationException("请输入插件面板显示的 32 位扩展 ID。");
      Directory.CreateDirectory(DirectoryPath);
      string executable = Path.Combine(DirectoryPath, "WordLens.Native.exe");
      string running = Assembly.GetExecutingAssembly().Location;
      if (!String.Equals(Path.GetFullPath(running), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase)) File.Copy(running, executable, true);
      string manifest = Path.Combine(DirectoryPath, HostName + ".json");
      var origins = new HashSet<string>(StringComparer.Ordinal) { "chrome-extension://" + id + "/" };
      if (File.Exists(manifest)) {
        try {
          var old = (Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(manifest));
          if (String.Equals(old["name"] as string, HostName, StringComparison.Ordinal) && String.Equals(old["path"] as string, executable, StringComparison.OrdinalIgnoreCase))
            foreach (object origin in (object[])old["allowed_origins"]) if (origin is string && Regex.IsMatch((string)origin, @"^chrome-extension://[a-p]{32}/$")) origins.Add((string)origin);
        } catch { }
      }
      File.WriteAllText(manifest, new JavaScriptSerializer().Serialize(new { name = HostName, description = "WordLens selected text bridge", path = executable, type = "stdio", allowed_origins = origins.ToArray() }), new UTF8Encoding(false));
      foreach (string browser in new[] { @"Software\Microsoft\Edge\NativeMessagingHosts\", @"Software\Google\Chrome\NativeMessagingHosts\" })
        using (var key = Registry.CurrentUser.CreateSubKey(browser + HostName)) key.SetValue("", manifest, RegistryValueKind.String);
    }
    public static void Unregister() {
      foreach (string browser in new[] { @"Software\Microsoft\Edge\NativeMessagingHosts\", @"Software\Google\Chrome\NativeMessagingHosts\" }) {
        string name = browser + HostName;
        using (var key = Registry.CurrentUser.OpenSubKey(name)) {
          if (key == null) continue;
          string expected = Path.Combine(DirectoryPath, HostName + ".json");
          if (!String.Equals(key.GetValue("") as string, expected, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("注册项不属于此安装位置，未更改。");
        }
        Registry.CurrentUser.DeleteSubKey(name, false);
      }
    }
  }
  static class SelfTests {
    public static int Run() {
      int passed = 0;
      try {
        using (var memory = new MemoryStream()) { Protocol.Write(memory, new { text = "Basic 中文 /ˈbeisik/" }); memory.Position = 0; var data = (Dictionary<string, object>)Protocol.Read(memory); if ((string)data["text"] != "Basic 中文 /ˈbeisik/") throw new Exception("UTF-8 roundtrip"); passed++; }
        foreach (byte[] invalid in new[] { new byte[] { 1, 0 }, new byte[] { 255, 255, 255, 127 }, new byte[] { 4, 0, 0, 0, 123 } }) {
          bool rejected = false; try { Protocol.Read(new MemoryStream(invalid)); } catch { rejected = true; } if (!rejected) throw new Exception("Invalid frame accepted"); passed++;
        }
        if (Installer.AllowedOrigin("https://example.com") || Installer.AllowedOrigin("chrome-extension://bad/")) throw new Exception("Origin accepted"); passed++;
        string origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/";
        string manifest = new JavaScriptSerializer().Serialize(new { name = Installer.HostName, allowed_origins = new[] { origin } });
        if (!Installer.OriginInManifest(origin, manifest) || Installer.OriginInManifest("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/", manifest)) throw new Exception("Manifest origin validation"); passed++;
        string[] selectionChecks = SelectionTests.Run();
        string[] popupChecks = PopupTests.Run();
        Protocol.Write(Console.OpenStandardOutput(), new { type = "self-test", passed = passed + selectionChecks.Length + popupChecks.Length, selectionChecks = selectionChecks, popupChecks = popupChecks }); return 0;
      } catch (Exception error) { Protocol.Write(Console.OpenStandardOutput(), new { type = "self-test", error = error.Message }); return 1; }
    }
  }
}
