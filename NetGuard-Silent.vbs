Set WShell = CreateObject("WScript.Shell")
appFolder = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WShell.CurrentDirectory = appFolder
WShell.Run "cmd /c npx electron .", 0, False
Set WShell = Nothing
