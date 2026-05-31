# Mermaid diagrams

Open this file in MikeDown. Each block below should render as a diagram.
Click a diagram to edit its source; click away to re-render.

## Flowchart

```mermaid
flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Ship it]
    B -->|No| D[Debug]
    D --> B
```

## Sequence

```mermaid
sequenceDiagram
    participant Webview
    participant Host
    Webview->>Host: saveSettings
    Host->>Host: config.update
    Host-->>Webview: settings broadcast
```

## Pie

```mermaid
pie title Time spent
    "Writing" : 45
    "Debugging" : 35
    "Meetings" : 20
```

## Invalid (should show source + inline error)

```mermaid
flowchart TD
    A --> B -->
```
