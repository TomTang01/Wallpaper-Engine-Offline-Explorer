# Wallpaper Engine Offline Explorer

A local webpage for browsing direct subfolders by image or GIF preview.

## Run

Double-click:

```text
Wallpaper Engine Offline Explorer.exe
```

This starts the local server on port `43196` and opens the app in your default browser.

You can also run the server manually:

```powershell
npm start
```

Then open:

```text
http://127.0.0.1:43196
```

The default root folder is:

```text
F:\Download\[WE data]
```

You can change the root folder from the input at the top of the page.

## Browser limitation

A normal webpage cannot reliably scan arbitrary local folders or open File Explorer because browsers restrict filesystem access for security. This app uses a local Node.js server on `127.0.0.1` to scan folders, serve image previews, and open the selected subfolder in the system file explorer.

When the browser tab is closed, the browser shows a standard leave-page confirmation. If the close proceeds, the page asks the local server to shut down. Browsers do not allow custom text in that close confirmation.

## Preview rules

- Only direct subfolders of the selected root are shown.
- Each direct subfolder is checked for the first supported file after alphabetic sorting.
- Supported extensions are `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`, and `.gif`.
- Subfolders with no supported preview file show an error state.
