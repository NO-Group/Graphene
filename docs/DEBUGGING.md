# Debug Adapter Protocol

Tungsten can launch any Debug Adapter Protocol implementation that communicates over standard input and output. Add `.tungsten/launch.json` to a project:

```json
{
  "version": "1.0",
  "configurations": [
    {
      "name": "Python: current application",
      "type": "python",
      "request": "launch",
      "adapter": {
        "command": "python",
        "args": ["-m", "debugpy.adapter"]
      },
      "arguments": {
        "program": "${workspaceFolder}/main.py",
        "console": "integratedTerminal"
      }
    }
  ]
}
```

The selected adapter must be installed on the computer and available on `PATH`. Tungsten handles DAP framing, initialization, launch, configuration completion, output events, and lifecycle management. Use the Run and Debug sidebar to start or stop the session and manage editor breakpoints.

Common adapters include `debugpy` for Python, `codelldb` for C/C++/Rust, `delve` for Go, and the Java debug server.
