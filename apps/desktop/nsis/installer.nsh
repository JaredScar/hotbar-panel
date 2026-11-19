; A silent update from an older Hotbar only passes /S. Relaunch unless --force-run already did.
!macro customInstall
  ${if} ${Silent}
    ${ifNot} ${isForceRun}
      HideWindow
      !insertmacro StartApp
    ${endIf}
  ${endIf}
!macroend
