using System;
using System.Runtime.InteropServices;

namespace WordLens.Native {
  // Armed only by Ctrl+C in the explicitly selected copy mode. Never scans history.
  sealed class CopyGate {
    IntPtr window;
    uint sequence;
    DateTime armedAt;
    bool armed;
    public void Arm(IntPtr owner, uint before, DateTime now) { window=owner; sequence=before; armedAt=now; armed=true; }
    public void Clear() { armed=false; }
    public bool Accept(IntPtr foreground, uint current, bool sameProcess, DateTime now) {
      if (!armed || now<armedAt || (now-armedAt).TotalMilliseconds>1500) { armed=false; return false; }
      if (window!=foreground || !sameProcess || current==0 || current==sequence) return false;
      armed=false; return true;
    }
  }
  static class CopySelection {
    [DllImport("user32.dll")] public static extern bool AddClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] public static extern bool RemoveClipboardFormatListener(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr window);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr memory);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
    public static bool OwnedBy(IntPtr foreground) {
      var owner=GetClipboardOwner(); if (owner==IntPtr.Zero) return false;
      uint source,target; GetWindowThreadProcessId(owner,out source); GetWindowThreadProcessId(foreground,out target);
      return source!=0 && source==target;
    }
    public static string Read(IntPtr host, out string text) {
      text=null;
      if (!OpenClipboard(host)) return "busy";
      try {
        var memory=GetClipboardData(13); // CF_UNICODETEXT only
        if (memory==IntPtr.Zero) return "copy-empty";
        ulong bytes=GlobalSize(memory).ToUInt64();
        if (bytes<2) return "copy-empty";
        var address=GlobalLock(memory); if (address==IntPtr.Zero) return "copy-empty";
        try {
          string value=Marshal.PtrToStringUni(address,(int)Math.Min(bytes/2,2001));
          int end=value.IndexOf('\0');
          if (end>=0) value=value.Substring(0,end);
          if (value.Length>2000) return "too-long";
          text=value.Trim();
        }
        finally { GlobalUnlock(memory); }
        return text.Length==0 ? "copy-empty" : "selected";
      } finally { CloseClipboard(); }
    }
    public static string[] Tests() {
      var gate=new CopyGate(); var now=DateTime.UtcNow; var window=new IntPtr(42);
      if (gate.Accept(window,2,true,now)) throw new Exception("Unarmed clipboard read");
      gate.Arm(window,1,now);
      if (gate.Accept(window,1,true,now) || gate.Accept(new IntPtr(43),2,true,now) || gate.Accept(window,2,false,now)) throw new Exception("Unrelated clipboard accepted");
      if (!gate.Accept(window,2,true,now) || gate.Accept(window,3,true,now)) throw new Exception("Copy update must be accepted once");
      gate.Arm(window,3,now); if (gate.Accept(window,4,true,now.AddSeconds(2))) throw new Exception("Expired copy accepted");
      gate.Arm(window,4,now); gate.Clear(); if (gate.Accept(window,5,true,now)) throw new Exception("Cancelled copy accepted");
      return new[] {"copy-requires-user-gesture-and-new-sequence","copy-requires-same-foreground-process","copy-is-once-bounded-and-cancellable"};
    }
  }
}
