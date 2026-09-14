# Tungsten extension manifests

Tungsten extensions are declarative folders. They do not execute arbitrary renderer code. Install one from the Extensions sidebar by selecting a folder containing `extension.json`.

```json
{
  "id": "acme.team-tools",
  "name": "Team Tools",
  "version": "1.0.0",
  "publisher": "Acme",
  "description": "Shared commands and language metadata.",
  "contributes": {
    "commands": [
      {
        "id": "acme.verify",
        "title": "Verify workspace",
        "command": "npm run check"
      }
    ],
    "languages": [
      {
        "id": "acme-config",
        "extensions": [".acme"]
      }
    ],
    "themes": []
  }
}
```

Extensions are copied into Tungsten's per-user application data directory. Workspace-local extensions may be placed under `.tungsten/extensions/<extension-id>/extension.json`.

The current extension API loads and displays manifests and contributions. Future versions can add signed marketplace packages while preserving the declarative security boundary.
