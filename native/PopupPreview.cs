using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Windows.Forms;

namespace WordLens.Native {
  static class PopupPreview {
    // Fixed public samples only; never captures the screen or a user's document.
    public static int Run(string directory) {
      try {
        directory=Path.GetFullPath(directory); Directory.CreateDirectory(directory);
        var cases=new[] {
          new {Name="word",Word="Basic",Kind="word",Phonetic="/ˈbeɪsɪk/",Lines=new[] {"adj. 基本的；基础的", "n. 基础；基本要素"},Translation=false},
          new {Name="phrase",Word="take care of",Kind="phrase",Phonetic="短语释义",Lines=new[] {"phr. 照顾；照料；负责处理"},Translation=false},
          new {Name="sentence",Word="Small steps make a big difference.",Kind="sentence",Phonetic="英文 → 简体中文",Lines=new[] {"小小的进步，也能带来很大的改变。"},Translation=true}
        };
        foreach (var sample in cases) using (var popup=new Popup(value=>{},()=>{})) {
          popup.Prepare("preview",new SelectedText {Text=sample.Word});
          popup.Render(new Dictionary<string,object> {{"result",new Dictionary<string,object> {{"status","ok"},{"word",sample.Word},{"kind",sample.Kind},{"displayPhonetic",sample.Phonetic},{"definitions",sample.Lines},{"translation",sample.Translation}}}},false);
          Render(popup,Path.Combine(directory,"native-"+sample.Name+".png"));
          if (sample.Name=="sentence") {
            popup.Note("没有检测到本地英语语音，请在插件面板查看语音安装帮助。");
            Render(popup,Path.Combine(directory,"native-speech-help.png"));
          }
        }
        Protocol.Write(Console.OpenStandardOutput(),new {type="preview",directory=directory}); return 0;
      } catch (Exception error) { Protocol.Write(Console.OpenStandardOutput(),new {type="preview-error",message=error.Message}); return 1; }
    }
    static void Render(Form form,string path) {
      form.Opacity=0; form.Show(); Application.DoEvents(); form.PerformLayout();
      foreach (Control control in form.Controls) {
        if (control.Left<0 || control.Top<0 || control.Right>form.ClientSize.Width || control.Bottom>form.ClientSize.Height) throw new Exception("Control outside card: "+control.AccessibleName);
        control.CreateControl();
      }
      using (var bitmap=new Bitmap(form.Width,form.Height)) {
        using (var g=form.CreateGraphics()) bitmap.SetResolution(g.DpiX,g.DpiY);
        form.DrawToBitmap(bitmap,new Rectangle(Point.Empty,form.Size)); bitmap.Save(path,ImageFormat.Png);
      }
      form.Hide();
    }
  }
}
