using System;
using System.Collections.Generic;

namespace WordLens.Native {
  // Mouse hooks must not call UIA. Classify the physical gesture using only
  // copied hook data; a plain button click is never an automatic selection.
  sealed class SelectionGesture {
    readonly int dragX, dragY, clickX, clickY;
    readonly uint interval;
    bool down, previous;
    IntPtr window, previousWindow;
    SelectionCapture.NativePoint start, last;
    uint lastTime;
    public SelectionGesture(int dragX, int dragY, int clickX, int clickY, uint interval) {
      this.dragX=Math.Max(2,dragX); this.dragY=Math.Max(2,dragY);
      this.clickX=Math.Max(1,clickX); this.clickY=Math.Max(1,clickY); this.interval=interval;
    }
    public void Reset() { down=false; previous=false; }
    public void Press(IntPtr owner, SelectionCapture.NativePoint point, bool blocked) {
      if (blocked) { Reset(); return; }
      down=true; window=owner; start=point;
    }
    public bool Release(IntPtr owner, SelectionCapture.NativePoint point, uint time, bool blocked) {
      if (!down || blocked || owner!=window) { Reset(); return false; }
      down=false;
      bool drag=Math.Abs((long)point.X-start.X)>=dragX || Math.Abs((long)point.Y-start.Y)>=dragY;
      bool multiple=previous && owner==previousWindow && unchecked(time-lastTime)<=interval
        && Math.Abs((long)point.X-last.X)<=clickX && Math.Abs((long)point.Y-last.Y)<=clickY;
      previous=!drag; previousWindow=owner; last=point; lastTime=time;
      return drag || multiple;
    }
    public static string[] Tests() {
      var checks=new List<string>(); var gate=new SelectionGesture(4,4,4,4,500);
      var window=new IntPtr(1); var word=new SelectionCapture.NativePoint {X=100,Y=100};
      var button=new SelectionCapture.NativePoint {X=140,Y=180};
      gate.Press(window,word,false);
      if (gate.Release(window,word,100,false)) throw new Exception("Single click captured stale selection");
      gate.Press(window,word,false);
      if (!gate.Release(window,word,200,false)) throw new Exception("Double-click word not captured");
      gate.Press(window,button,false);
      if (gate.Release(window,button,300,false)) throw new Exception("Speaker click treated as selection");
      button.X=400; gate.Press(window,button,false);
      if (gate.Release(window,button,400,false)) throw new Exception("Close click treated as selection");
      checks.Add("single-speech-and-close-clicks-never-capture");
      gate.Press(window,word,false);
      if (!gate.Release(window,new SelectionCapture.NativePoint {X=250,Y=100},1000,false)) throw new Exception("Drag not captured");
      gate.Press(window,word,false);
      if (gate.Release(window,word,1100,false)) throw new Exception("Drag armed a double click");
      gate.Press(window,word,false);
      if (!gate.Release(window,word,1200,false)) throw new Exception("Reselect after drag failed");
      checks.Add("drag-and-fresh-double-click-remain-available");
      gate.Press(window,word,true);
      if (gate.Release(window,word,1300,false)) throw new Exception("Native card click escaped gate");
      gate.Press(window,word,false);
      if (gate.Release(new IntPtr(2),word,1400,false)) throw new Exception("Window switch captured");
      gate.Press(window,word,false); gate.Reset();
      if (gate.Release(window,word,1500,false)) throw new Exception("Cancelled gesture captured");
      checks.Add("card-window-switch-and-scroll-cancel-gestures");
      gate.Press(window,word,false); gate.Release(window,word,UInt32.MaxValue-50,false);
      gate.Press(window,word,false);
      if (!gate.Release(window,word,20,false)) throw new Exception("Hook timestamp rollover broke double click");
      checks.Add("double-click-timestamp-rollover");
      return checks.ToArray();
    }
  }
}
