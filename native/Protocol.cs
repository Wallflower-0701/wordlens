using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

namespace WordLens.Native {
  public static class Protocol {
    const int Maximum = 65536;
    public static object Read(Stream stream) {
      byte[] header = new byte[4]; int count = stream.Read(header, 0, 4);
      if (count == 0) return null;
      while (count < 4) { int got = stream.Read(header, count, 4 - count); if (got == 0) throw new EndOfStreamException(); count += got; }
      int length = BitConverter.ToInt32(header, 0);
      if (length <= 0 || length > Maximum) throw new InvalidDataException("Invalid native message size.");
      byte[] bytes = new byte[length]; count = 0;
      while (count < length) { int got = stream.Read(bytes, count, length - count); if (got == 0) throw new EndOfStreamException(); count += got; }
      return new JavaScriptSerializer { MaxJsonLength = Maximum }.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes));
    }
    public static void Write(Stream stream, object message) {
      byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer { MaxJsonLength = Maximum }.Serialize(message));
      if (bytes.Length > Maximum) throw new InvalidDataException("Native message too large.");
      lock (stream) { byte[] header = BitConverter.GetBytes(bytes.Length); stream.Write(header, 0, 4); stream.Write(bytes, 0, bytes.Length); stream.Flush(); }
    }
  }
}
