import Core
import Foundation
import UIKit

/// DEBUG-only. `PROCRASTIMATE_DEMO=bulk:<n>` seeds `n` tasks once, nine in ten completed, across 15 projects and 20
/// labels, with subtasks, comments, and two images on every twelfth open task, so lag can be measured at any size.
/// `PROCRASTIMATE_PERF=<host path>` appends one line per main run loop pass longer than 8 ms to that file, and the word
/// `script` then opens details, completes tasks, and switches tabs on a fixed schedule, marking each phase in
/// `<path>.marks`, so the numbers carry no XCUITest or accessibility work. `visitall` opens every tab first.
enum PerfDemo {
    @MainActor
    static func run(store: Store, clock: AppClock, navigator: Navigator, actions: TaskActions) async {
        #if DEBUG
        guard let path = ProcessInfo.processInfo.environment["PROCRASTIMATE_PERF"] else { return }
        StallMonitor.start(path)
        if let count = PlacesDemo.value("bulk").flatMap(Int.init), store.tasks.count < count {
            store.commit(data(count, today: clock.today, now: clock.now.epochMilliseconds))
        }
        if PlacesDemo.has("script") { await script(path, store: store, clock: clock, navigator: navigator, actions: actions) }
        #endif
    }

    #if DEBUG
    @MainActor
    private static func script(_ path: String, store: Store, clock: AppClock, navigator: Navigator, actions: TaskActions) async {
        FileManager.default.createFile(atPath: "\(path).marks", contents: nil)
        let marks = FileHandle(forWritingAtPath: "\(path).marks")
        func mark(_ phase: String) { marks?.write(Data("\(Int(Date().timeIntervalSince1970 * 1000))\t\(phase)\n".utf8)) }
        func pause(_ milliseconds: Int = 1200) async { try? await Task.sleep(for: .milliseconds(milliseconds)) }
        await pause(3000)
        let inbox = navigator.tab
        let today = Views.dueDays(store.tasks, clock.today, .inbox, in: store.timeZone)
        let first = (today.overdue + today.today + today.days.flatMap(\.tasks)).first { !$0.images.isEmpty } ?? store.tasks[0]
        if PlacesDemo.has("visitall") {
            for tab in navigator.pins.map(AppTab.pin) + [.browse] {
                navigator.tab = tab
                await pause(800)
            }
            navigator.tab = inbox
        }
        await pause()
        mark("details")
        for _ in 0 ..< 5 {
            navigator.sheet = .details(taskID: first.id)
            await pause()
            navigator.sheet = nil
            await pause()
        }
        navigator.tab = inbox
        await pause()
        mark("complete")
        var completed: [String] = []
        for _ in 0 ..< 6 {
            let due = Views.dueDays(store.tasks, clock.today, .inbox, in: store.timeZone)
            guard let task = (due.overdue + due.today + due.days.flatMap(\.tasks)).first else { break }
            actions.complete(task)
            completed.append(task.id)
            await pause(1500)
        }
        // After the toasts of the last completions are gone, so they don't land on the tab switches.
        await pause(4000)
        mark("tabs")
        for _ in 0 ..< 4 {
            navigator.tab = .browse
            await pause()
            navigator.tab = inbox
            await pause()
        }
        mark("end")
        // Every run starts from the same tasks.
        for id in completed { store.reopenTask(id) }
        await store.saved()
        mark("done")
    }

    private static func data(_ count: Int, today: DateKey, now: Int) -> StoreData {
        let day = 86_400_000
        let projects = (0 ..< 15).map { Project(id: "perf-p\($0)", name: "Project \($0)", order: Double($0), createdAt: now) }
        let labels = (0 ..< 20).map { Label(id: "perf-l\($0)", name: "label\($0)", color: .blue, createdAt: now) }
        let open = count / 10
        var tasks: [TaskItem] = []
        var comments: [Comment] = []
        for index in 0 ..< count {
            let done = index >= open
            let id = "perf-t\(index)"
            var task = TaskItem(
                id: id,
                order: Double(index),
                title: "Task number \(index) with a reasonably long title to wrap",
                notes: index % 3 == 0 ? "Some notes for \(index)" : "",
                projectId: index % 4 == 0 ? nil : projects[index % projects.count].id,
                labelIds: index % 2 == 0 ? [labels[index % labels.count].id, labels[(index + 7) % labels.count].id] : [],
                priority: [.p1, .p2, .p3, .p4][index % 4],
                createdAt: now - (count - index) * day / 4
            )
            if done {
                task.completedAt = now - (index - open) * day / 6
                task.lastCompletedAt = task.completedAt
            } else if index % 3 != 0 {
                task.due = Due(date: Dates.addDays(today, index % 30 - 5), time: index % 5 == 0 ? "09:30" : nil)
            }
            if !done, index % 12 == 1 {
                task.images = (0 ..< 2).map { ImageRef(id: "perf-img-\(index)-\($0)", width: 2048, height: 1536) }
            }
            if index % 25 == 0 {
                comments += (0 ..< 3).map { Comment(id: "perf-c\(index)-\($0)", taskId: id, body: "Comment \($0)", createdAt: now) }
            }
            tasks.append(task)
            if index % 20 == 1 {
                tasks += (0 ..< 3).map {
                    TaskItem(
                        id: "perf-s\(index)-\($0)", parentId: id, order: Double($0), title: "Subtask \($0) of \(index)",
                        projectId: task.projectId, createdAt: task.createdAt, completedAt: $0 == 0 ? task.createdAt : nil
                    )
                }
            }
        }
        for (offset, image) in tasks.flatMap(\.images).enumerated() { TaskImages.seedCached(image.id, hue: Double(offset % 40) / 40) }
        return StoreData(tasks: tasks, projects: projects, labels: labels, comments: comments)
    }
    #endif
}

#if DEBUG
/// Times each main run loop pass from waking to sleeping again, the work a tap waits behind.
@MainActor
private enum StallMonitor {
    private static var handle: FileHandle?
    private static var began: CFAbsoluteTime = 0

    static func start(_ path: String) {
        FileManager.default.createFile(atPath: path, contents: nil)
        handle = FileHandle(forWritingAtPath: path)
        let observer = CFRunLoopObserverCreateWithHandler(
            nil, CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue, true, 0
        ) { _, activity in
            let now = CFAbsoluteTimeGetCurrent()
            if activity == .afterWaiting {
                began = now
            } else if began > 0, now - began > 0.008 {
                let line = "\(Int((Date().timeIntervalSince1970) * 1000))\t\(Int((now - began) * 1000))\n"
                handle?.write(Data(line.utf8))
            }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
    }
}
#endif
