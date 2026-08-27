Option Explicit
Dim shell, fs, root, python
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
root = fs.GetParentFolderName(root)
python = root & "\.venv\Scripts\pythonw.exe"
shell.CurrentDirectory = root
shell.Run Chr(34) & python & Chr(34) & " -m server.launcher", 0, False
