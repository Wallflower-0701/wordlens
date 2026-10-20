using System;
using System.Collections.Generic;
using System.Windows.Forms;

namespace WordLens.Native {
  static class PopupTests {
    public static string[] Run() {
      Popup popup=null; int closed=0;
      popup=new Popup(value=>{},()=>{closed++;popup.Hide();});
      try {
        popup.Opacity=0;
        popup.Prepare("first",new SelectedText {Text="Basic"});
        var message=new Dictionary<string,object> {{"result",new Dictionary<string,object> {{"status","ok"},{"word","Basic"},{"kind","word"},{"displayPhonetic","/ˈbeɪsɪk/"},{"definitions",new[] {"adj. 基本的；基础的"}}}}};
        popup.Render(message); Application.DoEvents();
        popup.Close(); Application.DoEvents();
        if (popup.IsDisposed || closed!=1 || popup.Visible) throw new Exception("User close disposed the reusable popup");
        popup.Prepare("second",new SelectedText {Text="Basic"}); popup.Render(message); Application.DoEvents();
        if (popup.IsDisposed || !popup.Visible) throw new Exception("Popup cannot reopen after user close");
        popup.Close(); Application.DoEvents();
        if (closed!=2) throw new Exception("Repeated close was not handled");
        popup.Prepare("inflected",new SelectedText {Text="studies"});
        var inflected = new Dictionary<string,object> {{"result",new Dictionary<string,object> {{"status","ok"},{"word","study"},{"kind","word"},{"isBaseForm",true},{"definitions",new[] {"v. 学习"}}}}};
        popup.Render(inflected,false);
        if (FindHeading(popup)!="studies") throw new Exception("Dictionary base form replaced selected text");
        return new[] {"close-keeps-popup-reusable","lookup-reopens-after-close","selected-heading-preserved-for-base-form"};
      } finally { popup.Dispose(); }
    }
    static string FindHeading(Control parent) {
      foreach (Control child in parent.Controls) {
        if (child.AccessibleName=="所选英文") return child.Text;
        string value=FindHeading(child); if (value!=null) return value;
      }
      return null;
    }
  }
}
