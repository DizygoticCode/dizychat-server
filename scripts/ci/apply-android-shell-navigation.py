from pathlib import Path

path = Path('public/chat.js')
text = path.read_text(encoding='utf-8')

hook = '''window.dizychatMobile = {\n  handleBack() {\n    if (replyState.targetId) {\n      clearReplyTarget();\n      return true;\n    }\n\n    if (appState.activeMenu || (userContextMenu && !userContextMenu.hasAttribute("hidden"))) {\n      if (appState.activeMenu) {\n        closeActiveMenu();\n      } else {\n        userContextMenu.classList.remove("open");\n        userContextMenu.setAttribute("hidden", "");\n        userContextMenu.setAttribute("aria-hidden", "true");\n      }\n      return true;\n    }\n\n    if (mobileSidebarQuery?.matches && userSidebar?.classList.contains("is-expanded")) {\n      setMobileSidebarExpanded(false);\n      return true;\n    }\n\n    if (emojiPickerController?.isVisible?.()) {\n      emojiPickerController.hide();\n      return true;\n    }\n\n    if (isViewingChat) {\n      leaveBtn?.click();\n      return true;\n    }\n\n    return false;\n  },\n};\n'''

if hook in text:
    print('Android mobile back hook already present')
    raise SystemExit(0)

marker = '''  })();\n}\n\n// ------------------- Sending Messages -------------------\n'''
if marker not in text:
    raise SystemExit('emoji picker boundary not found')

replacement = f'''  }})();\n}}\n\n{hook}\n// ------------------- Sending Messages -------------------\n'''
text = text.replace(marker, replacement, 1)
path.write_text(text, encoding='utf-8')
print('Applied Android shell navigation chat hook')
