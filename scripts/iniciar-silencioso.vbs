Option Explicit
Dim shell, fs, root, python
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
root = fs.GetParentFolderName(root)
python = root & "\.venv\Scripts\pythonw.exe"
shell.CurrentDirectory = root
shell.Run Chr(34) & python & Chr(34) & " -m uvicorn server.app:app --host 127.0.0.1 --port 8765", 0, False
