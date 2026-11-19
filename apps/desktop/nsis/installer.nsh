; A silent update from an older Hotbar only passes /S. Relaunch unless --force-run already did.
; Do not call StartApp here. That macro declares a variable, and the finish step declares it too.
!macro customInstall
  ${if} ${Silent}
    ${ifNot} ${isForceRun}
      HideWindow
      ${if} ${isUpdated}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
      ${else}
        ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
      ${endIf}
    ${endIf}
  ${endIf}
!macroend
