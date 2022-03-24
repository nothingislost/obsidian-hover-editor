## Obsidian Hover Editor

This plugin enhances the core "Page Preview" plugin by turning the hover popover into a full featured editor instance.

### Disclaimer

This plugin leverages Obsidian functionality that is not currently exposed in the official API. As a result, future Obsidian updates may introduce breaking changes.

I will attempt to keep this plugin working across Obsidian updates but my goal is to either have this functionality implemented directly into Obsidian core or switch over to using the official API for popovers, once it is made available.

### Features

- The page preview popover is now an actual editor instance
  - Most editor functionality is supported including switching between modes
- The popover is now draggable and resizable
- The popover can now be pinned to prevent it from auto closing
  - Popovers will auto pin when dragged or resized
  - With pinning, multiple popovers can be open at the same time
- When opening a popover, it will become the active pane and receive focus
  - This means you can use keyboard shortcuts like ctrl+e to switch modes after triggering a popover
  - When the popover closes, focus will revert back to the previous document
- The popover now has a nav bar which includes the document title and editor controls
- The top drag handle can be double clicked to minimize the popover
- There is a plugin setting that allows for setting the default editor mode
  - Options are: "Open in Reading mode", "Open in Editing mode", or "Match the mode of the current document"
- When hovering a link containing header or block ref, the editor will open and auto scroll to the ref location
- When multiple popovers are active and on top of each other, the currently active popover will remain on top

### Demo

https://user-images.githubusercontent.com/89109712/160023366-7a1ca044-5725-4d30-a0a7-f7e0664281da.mp4

### Installing

Hover Editor can be found and installed via the Obsidian Community Plugins browser

### Installing via BRAT

If you want to participate in early testing you can install the plugin using BRAT.

Install the BRAT plugin via the Obsidian Plugin Browser and then add the beta repository "nothingislost/obsidian-hover-editor"

### Manually installing the plugin

- Copy over `main.js`, `manifest.json` to your vault `VaultFolder/.obsidian/plugins/obsidian-hover-editor/`.

### Acknowledgments

Thanks to pjeby for contributing a ton of core functionality related to making Hover Editors interop properly with native Obsidian components

Thanks to boninall for contributing the "open in new popover" functionality

Thanks to murf, liam, obadiahcruz, and javalent for the early testing and feedback
