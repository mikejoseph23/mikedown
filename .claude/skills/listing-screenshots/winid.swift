// Prints the CGWindowID of the largest on-screen, normal-layer window owned by a PID.
// Usage: winid <pid> [--activate]   (exit 1 when none is found)
// --activate brings that one app instance to the front first (System Events'
// "frontmost" picks the wrong instance when several VS Code processes run).
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let pid = Int32(args[1]) else {
    FileHandle.standardError.write("usage: winid <pid> [--activate]\n".data(using: .utf8)!)
    exit(2)
}
if args.contains("--activate") {
    NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
    Thread.sleep(forTimeInterval: 0.6)
}
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var best: (id: Int, area: Double)? = nil
for w in list {
    guard (w[kCGWindowOwnerPID as String] as? Int32) == pid,
          (w[kCGWindowLayer as String] as? Int) == 0,
          let id = w[kCGWindowNumber as String] as? Int,
          let b = w[kCGWindowBounds as String] as? [String: Double] else { continue }
    let area = (b["Width"] ?? 0) * (b["Height"] ?? 0)
    if best == nil || area > best!.area { best = (id, area) }
}
guard let found = best else { exit(1) }
print(found.id)
