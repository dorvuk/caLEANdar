; Keep existing shortcut properties and AppUserModelID while refreshing the icon.
!macro RefreshCalendarShortcutIcon shortcut
  !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READWRITE})'
        ${IShellLink::SetIconLocation} $0 '(w "$INSTDIR\icons\caLEANdar-${VERSION}.ico", 0)'
        ${IPersistFile::Save} $1 '("${shortcut}",1)'
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "${shortcut}", p 0)'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; A different filename on each release avoids stale icons cached for the exe.
  CreateDirectory "$INSTDIR\icons"
  SetOutPath "$INSTDIR\icons"
  File "/oname=caLEANdar-${VERSION}.ico" "${INSTALLERICON}"
  SetOutPath "$INSTDIR"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\icons\caLEANdar-${VERSION}.ico,0"
  !insertmacro RefreshCalendarShortcutIcon "$DESKTOP\${PRODUCTNAME}.lnk"
  !insertmacro RefreshCalendarShortcutIcon "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro RefreshCalendarShortcutIcon "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !endif
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\icons\caLEANdar-*.ico"
  RMDir "$INSTDIR\icons"
!macroend
