; Tauri includes hooks before defining VERSION and PRODUCTNAME. Populate these
; runtime paths in POSTINSTALL, after the installer has defined its metadata.
!define LUMEN_HOOK_DIR "${__FILEDIR__}"
Var LumenShortcutIcon
Var LumenShortcutTarget
Var LumenDesktopShortcut
Var LumenStartMenuShortcut
Var LumenLegacyStartMenuShortcut
Var LumenShortcutPath

Function LumenUpdateShortcutIcon
  ${IfNot} ${FileExists} "$LumenShortcutPath"
    Return
  ${EndIf}
  Push $0
  Push $1
  Push $2
  Push $3
  ; Update only shortcuts that still belong to this installation. Editing the
  ; existing ShellLink preserves arguments, working directory and AppUserModelID.
  !insertmacro IsShortcutTarget "$LumenShortcutPath" "$LumenShortcutTarget"
  Pop $3
  ${If} $3 = 1
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("$LumenShortcutPath", ${STGM_READWRITE})'
        ${IShellLink::SetIconLocation} $0 '("$LumenShortcutIcon", 0)'
        ${IPersistFile::Save} $1 '("$LumenShortcutPath",1)'
        ${IUnknown::Release} $1 ""
        ; SHCNE_UPDATEITEM + SHCNF_PATHW | SHCNF_FLUSH updates this shortcut only.
        System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$LumenShortcutPath", p 0)'
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function LumenRefreshShortcutIcons
  ${If} $LumenShortcutIcon == ""
    Return
  ${EndIf}
  ${IfNot} ${FileExists} "$LumenShortcutIcon"
    Return
  ${EndIf}
  StrCpy $LumenShortcutPath $LumenDesktopShortcut
  Call LumenUpdateShortcutIcon
  StrCpy $LumenShortcutPath $LumenStartMenuShortcut
  Call LumenUpdateShortcutIcon
  StrCpy $LumenShortcutPath $LumenLegacyStartMenuShortcut
  Call LumenUpdateShortcutIcon
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  ; A new icon filename per version avoids Windows reusing the old executable's
  ; cached image even when the application stays at the same install path.
  SetOutPath "$INSTDIR"
  File /oname=lumen-shortcut-${VERSION}.ico "${LUMEN_HOOK_DIR}\..\icons\icon.ico"
  StrCpy $LumenShortcutIcon "$INSTDIR\lumen-shortcut-${VERSION}.ico"
  StrCpy $LumenShortcutTarget "$INSTDIR\${MAINBINARYNAME}.exe"
  StrCpy $LumenDesktopShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
  StrCpy $LumenStartMenuShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  StrCpy $LumenLegacyStartMenuShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  Call LumenRefreshShortcutIcons
!macroend

; An interactive installer can create the desktop shortcut on its final page,
; after POSTINSTALL. Cover that path as well as silent/passive updates above.
Function .onGUIEnd
  Call LumenRefreshShortcutIcons
FunctionEnd

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\lumen-shortcut-*.ico"
!macroend
