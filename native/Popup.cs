using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace WordLens.Native {
  sealed class CardButton : Button {
    public bool Speaker;
    bool hover;
    public CardButton() {
      SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
      SetStyle(ControlStyles.Selectable, false);
      TabStop = false; Cursor = Cursors.Hand; FlatStyle = FlatStyle.Flat;
      MouseEnter += delegate { hover = true; Invalidate(); }; MouseLeave += delegate { hover = false; Invalidate(); };
    }
    protected override void OnPaint(PaintEventArgs e) {
      var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
      float scale = DeviceScale, radius = 10 * scale;
      Color fill = Speaker ? (hover ? Color.FromArgb(219, 239, 232) : Color.FromArgb(235, 246, 241)) : (hover ? Color.FromArgb(241, 245, 243) : BackColor);
      using (var path = Popup.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), radius))
      using (var brush = new SolidBrush(fill)) g.FillPath(brush, path);
      Color ink = Enabled ? Color.FromArgb(40, 112, 91) : Color.FromArgb(159, 174, 166);
      using (var pen = new Pen(Speaker ? ink : Color.FromArgb(130, 143, 137), 1.55f * scale)) {
        pen.StartCap = pen.EndCap = LineCap.Round; pen.LineJoin = LineJoin.Round;
        if (Speaker) {
          float x = 14 * scale, y = Height / 2f;
          g.DrawPolygon(pen, new PointF[] { new PointF(x,y-3*scale),new PointF(x+3*scale,y-3*scale),new PointF(x+7*scale,y-7*scale),new PointF(x+7*scale,y+7*scale),new PointF(x+3*scale,y+3*scale),new PointF(x,y+3*scale) });
          g.DrawArc(pen, x+5*scale,y-6*scale,10*scale,12*scale,-55,110);
          TextRenderer.DrawText(g, Enabled ? "朗读" : "…", Font, new Rectangle((int)(36*scale),0,Width-(int)(39*scale),Height),ink,TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding);
        } else {
          float c = Width / 2f, d = 3.5f * scale;
          g.DrawLine(pen,c-d,c-d,c+d,c+d); g.DrawLine(pen,c+d,c-d,c-d,c+d);
        }
      }
    }
    public float DeviceScale = 1;
  }
  sealed class Popup : Form {
    internal static readonly Color Ink = Color.FromArgb(32, 47, 42), Muted = Color.FromArgb(126, 140, 132), Accent = Color.FromArgb(40, 112, 91);
    readonly Action<object> send;
    readonly Action closeRequested;
    readonly Label heading, phonetic, source, caption;
    readonly Panel headingArea, definitions;
    readonly CardButton speak;
    readonly float scale;
    readonly Font wordFont, sentenceFont, definitionFont, badgeFont, escapeFont;
    readonly List<Control> rows = new List<Control>();
    string request = "";
    int dividerY, footerY, headingHeight, bodyHeight, footerHeight;
    SelectedText anchor;
    public Popup(Action<object> sender, Action closeRequested) {
      send = sender; this.closeRequested = closeRequested; TopMost = true; ShowInTaskbar = false; FormBorderStyle = FormBorderStyle.None;
      AutoScaleMode = AutoScaleMode.None; StartPosition = FormStartPosition.Manual; DoubleBuffered = true;
      using (var screen = Graphics.FromHwnd(IntPtr.Zero)) scale = screen.DpiX / 96f;
      BackColor = Color.White; ForeColor = Ink; Font = new Font("Microsoft YaHei UI", 9.5f);
      Text = "WordLens 原页面查词"; AccessibleName = Text;
      wordFont = new Font("Georgia", 27, FontStyle.Regular); sentenceFont = new Font("Segoe UI", 13.5f);
      definitionFont = new Font("Microsoft YaHei UI", 10.5f); badgeFont = new Font("Georgia", 10, FontStyle.Italic); escapeFont = new Font("Segoe UI",7.5f);
      var brand = Label("WordLens", 51, 20, 160, 24, new Font("Segoe UI", 10.5f, FontStyle.Bold), Ink);
      var subtitle = Label("划词 · 翻译", 140, 22, 130, 20, new Font("Microsoft YaHei UI", 8.5f), Muted);
      var close = new CardButton { Location = P(344,16), Size = Z(30,30), BackColor = BackColor, DeviceScale = scale, AccessibleName = "关闭释义" };
      close.Click += delegate { closeRequested(); };
      headingArea = new Panel { Location = P(24,64), Width = S(336), AutoScroll = true, BackColor = BackColor };
      heading = new Label { Location = Point.Empty, Width = S(326), Font = wordFont, ForeColor = Ink, UseMnemonic = false, AccessibleName = "所选英文" };
      headingArea.Controls.Add(heading);
      phonetic = Label("",24,115,235,30,new Font("Segoe UI",11.5f),Muted);
      speak = new CardButton { Size = Z(88,34), Speaker = true, Font = new Font("Microsoft YaHei UI",9), BackColor = BackColor, DeviceScale = scale, AccessibleName = "朗读所选英文" };
      speak.Click += delegate { speak.Enabled = false; Note("正在调用本地英语语音…"); speak.Enabled = false; send(new { type = "speak", requestId = request }); };
      caption = Label("中文释义",24,0,300,20,new Font("Microsoft YaHei UI",8.5f),Muted);
      definitions = new Panel { Left = S(24), Width = S(344), AutoScroll = true, BackColor = BackColor, AccessibleName = "中文释义或翻译" };
      source = Label("",24,0,286,22,new Font("Microsoft YaHei UI",8.5f),Muted);
      Controls.AddRange(new Control[] { brand,subtitle,close,headingArea,phonetic,speak,caption,definitions,source });
      Size = Z(392,300); footerHeight = S(46);
    }
    Label Label(string text, int x, int y, int width, int height, Font font, Color color) {
      return new Label { Text=text, Location=P(x,y), Size=Z(width,height),Font=font,ForeColor=color,BackColor=Color.Transparent,UseMnemonic=false };
    }
    int S(float value) { return (int)Math.Round(value * scale); }
    Point P(int x, int y) { return new Point(S(x),S(y)); }
    Size Z(int w, int h) { return new Size(S(w),S(h)); }
    internal static GraphicsPath Rounded(RectangleF r, float radius) {
      var p = new GraphicsPath(); float d = radius * 2;
      p.AddArc(r.Left,r.Top,d,d,180,90); p.AddArc(r.Right-d,r.Top,d,d,270,90);
      p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90); p.AddArc(r.Left,r.Bottom-d,d,d,90,90); p.CloseFigure(); return p;
    }
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override void OnFormClosing(FormClosingEventArgs e) {
      base.OnFormClosing(e);
      if (e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; closeRequested(); }
    }
    protected override CreateParams CreateParams { get { var p=base.CreateParams; p.ExStyle |= 0x08000000 | 0x00000080; p.ClassStyle |= 0x20000; return p; } }
    protected override void WndProc(ref System.Windows.Forms.Message m) { if (m.Msg==0x21) { m.Result=new IntPtr(3); return; } base.WndProc(ref m); }
    protected override void OnPaint(PaintEventArgs e) {
      base.OnPaint(e); var g=e.Graphics; g.SmoothingMode=SmoothingMode.AntiAlias;
      using (var footer=new SolidBrush(Color.FromArgb(248,250,249))) g.FillRectangle(footer,0,footerY,Width,Height-footerY);
      using (var line=new Pen(Color.FromArgb(233,239,235))) { g.DrawLine(line,S(24),dividerY,Width-S(24),dividerY); g.DrawLine(line,0,footerY,Width,footerY); }
      using (var logo=new SolidBrush(Accent)) using (var shape=Rounded(new RectangleF(S(24),S(21),S(20),S(21)),S(5))) g.FillPath(logo,shape);
      using (var pen=new Pen(Color.White,S(1.3f))) { g.DrawLines(pen,new PointF[] {new PointF(S(28),S(28)),new PointF(S(31),S(35)),new PointF(S(34),S(29)),new PointF(S(37),S(35)),new PointF(S(40),S(28))}); }
      TextRenderer.DrawText(g,"ESC",escapeFont,new Rectangle(Width-S(59),footerY,S(37),footerHeight),Muted,TextFormatFlags.VerticalCenter | TextFormatFlags.HorizontalCenter);
      using (var border=new Pen(Color.FromArgb(219,229,223))) using (var shape=Rounded(new RectangleF(.5f,.5f,Width-1,Height-1),S(18))) g.DrawPath(border,shape);
    }
    void SetHeading(string text, bool word) {
      heading.Text=text; heading.Font=word && text.Length<24 ? wordFont : sentenceFont;
      var size=TextRenderer.MeasureText(text,heading.Font,new Size(S(316),Int32.MaxValue),TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
      heading.Height=Math.Max(S(44),size.Height+S(5)); headingHeight=Math.Min(S(100),heading.Height);
    }
    void SetDefinitions(IEnumerable<string> lines) {
      foreach (var control in rows) control.Dispose(); rows.Clear(); definitions.Controls.Clear();
      int y=0;
      foreach (string line in lines) {
        var match=Regex.Match(line,@"^([a-z]{1,6}\.(?:/[a-z]{1,6}\.)?)\s+(.+)$",RegexOptions.Singleline);
        int left=0;
        if (match.Success) {
          var tag=new Label { Text=match.Groups[1].Value,Font=badgeFont,ForeColor=Accent,BackColor=Color.FromArgb(236,246,240),TextAlign=ContentAlignment.MiddleCenter,UseMnemonic=false,Location=new Point(0,y+S(1)),Size=Z(39,23) };
          rows.Add(tag); definitions.Controls.Add(tag); left=S(51);
        }
        string text=match.Success ? match.Groups[2].Value : line;
        int width=S(320)-left;
        var measured=TextRenderer.MeasureText(text,definitionFont,new Size(width,Int32.MaxValue),TextFormatFlags.WordBreak | TextFormatFlags.NoPadding);
        var label=new Label { Text=text,Font=definitionFont,ForeColor=Ink,UseMnemonic=false,Location=new Point(left,y),Size=new Size(width,measured.Height+S(5)),BackColor=BackColor };
        rows.Add(label); definitions.Controls.Add(label); y+=Math.Max(label.Height,S(25))+S(10);
      }
      bodyHeight=Math.Max(S(47),y-S(5)); definitions.AutoScrollPosition=Point.Empty;
    }
    void LayoutCard() {
      headingArea.Height=headingHeight; headingArea.AutoScrollPosition=Point.Empty;
      phonetic.Top=headingArea.Bottom+S(9); speak.Location=new Point(Width-S(112),phonetic.Top-S(2));
      dividerY=Math.Max(phonetic.Bottom,speak.Bottom)+S(17);
      caption.Top=dividerY+S(15); definitions.Top=caption.Bottom+S(10);
      footerHeight=Math.Max(S(46),TextRenderer.MeasureText(source.Text,source.Font,new Size(source.Width,Int32.MaxValue),TextFormatFlags.WordBreak).Height+S(22));
      var cursor=SelectionCapture.Cursor(); var area=Screen.FromPoint(new Point(cursor.X,cursor.Y)).WorkingArea;
      int available=Math.Max(S(40),area.Height-S(30)-definitions.Top-footerHeight-S(16));
      definitions.Height=Math.Min(Math.Min(S(200),bodyHeight),available);
      footerY=definitions.Bottom+S(16); Height=footerY+footerHeight;
      source.Top=footerY+S(11); source.Height=footerHeight-S(20);
      using (var path=Rounded(new RectangleF(0,0,Width,Height),S(18))) { var previous=Region; Region=new Region(path); if (previous!=null) previous.Dispose(); }
      Place(); Invalidate();
    }
    void Place() {
      var cursor=SelectionCapture.Cursor(); var area=Screen.FromPoint(new Point(cursor.X,cursor.Y)).WorkingArea;
      int left=anchor==null || anchor.X==0 ? cursor.X : (int)anchor.X;
      int top=(anchor==null || anchor.Y==0 ? cursor.Y : (int)anchor.Y)+S(12);
      if (top+Height>area.Bottom-S(10)) top=(anchor==null ? cursor.Y : (int)anchor.Y)-Height-S(25);
      Location=new Point(Math.Max(area.Left+S(10),Math.Min(left,area.Right-Width-S(10))),Math.Max(area.Top+S(10),Math.Min(top,area.Bottom-Height-S(10))));
    }
    public void Prepare(string id, SelectedText selected) {
      request=id; anchor=selected; SetHeading(selected.Text,selected.Text.IndexOf(' ')<0);
      phonetic.Text="正在查询…"; speak.Enabled=false;
    }
    public void Render(Dictionary<string,object> message, bool display=true) {
      object raw; var result=message.TryGetValue("result",out raw) ? raw as Dictionary<string,object> : null;
      if (result==null) return;
      string status=Value(result,"status"),word=Value(result,"word"); speak.Enabled=status=="ok";
      if (status=="ok") {
        SetHeading(word,Value(result,"kind")=="word"); phonetic.Text=Value(result,"displayPhonetic");
        bool translated=Value(result,"translation")=="True"; caption.Text=translated ? "中文翻译" : "中文释义";
        var lines=new List<string>();
        if (result.TryGetValue("definitions",out raw) && raw is IEnumerable) foreach (object line in (IEnumerable)raw) if (line is string) lines.Add((string)line);
        SetDefinitions(lines); source.Text=translated ? "MyMemory · 仅翻译所选文字" : "ECDICT · 本地离线词典";
      } else {
        phonetic.Text="暂时无法查询"; caption.Text="提示";
        SetDefinitions(new[] {status=="not-found" ? "词典暂未收录这个单词，可以试试原形。" : Value(result,"message")});
        source.Text="WordLens · 原页面保持不变";
      }
      LayoutCard(); if (display) Show();
    }
    static string Value(Dictionary<string,object> value,string key) { object raw; return value.TryGetValue(key,out raw) && raw!=null ? raw.ToString() : ""; }
    public void Note(string text) { source.Text=text ?? ""; speak.Enabled=true; LayoutCard(); }
    protected override void Dispose(bool disposing) {
      if (disposing) { wordFont.Dispose(); sentenceFont.Dispose(); definitionFont.Dispose(); badgeFont.Dispose(); escapeFont.Dispose(); }
      base.Dispose(disposing);
    }
  }
}
