---
title: Product Spec — Task Board
status: In Progress
author: Sarah Chen
---

# Task Board Widget

## Overview

A lightweight task board component that lets users create, organize, and track tasks across three columns: **To Do**, **In Progress**, and **Done**.

## Requirements

- [x] Display tasks in a three-column Kanban layout
- [x] Each task shows a title, assignee, and priority badge
- [x] Color-coded priority levels: 🔴 High, 🟡 Medium, 🟢 Low
- [ ] Drag and drop tasks between columns
- [ ] Filter tasks by assignee

## API

The widget accepts a `tasks` array and an `onMove` callback:

```javascript
taskBoard.init({
  container: '#board',
  tasks: tasks,
  onMove: (taskId, newStatus) => { ... }
});
```

## Design Notes

> The board should feel fast and responsive. No loading spinners for local state changes — optimistic updates only.

| Column | Color | Description |
|--------|-------|-------------|
| To Do | `#f0f0f0` | Default landing column for new tasks |
| In Progress | `#e8f4fd` | Active work |
| Done | `#e8fde8` | Completed tasks, faded slightly |

## Open Questions

1. Should completed tasks auto-archive after 7 days?
2. Do we need a fourth "Blocked" column?
