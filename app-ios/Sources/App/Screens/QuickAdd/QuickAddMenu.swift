import Core
import SwiftUI

extension QuickAddButton {
    var name: String {
        switch self {
        case .date: "Date"
        case .priority: "Priority"
        case .reminders: "Reminders"
        case .repeat: "Repeat"
        case .labels: "Labels"
        case .subtasks: "Subtasks"
        case .images: "Images"
        case .location: "Location"
        case .event: "Event"
        }
    }

    var systemImage: String {
        switch self {
        case .date: "calendar"
        case .priority: "flag"
        case .reminders: "bell"
        case .repeat: "repeat"
        case .labels: "tag"
        case .subtasks: "checklist"
        case .images: "photo"
        case .location: "mappin"
        case .event: "calendar.badge.plus"
        }
    }
}

/// The `+` at the end of quick add's chip row: every attribute action, including the ones not pinned to the row,
/// and a `Customize row` submenu whose toggles pin or unpin each button for every device.
struct QuickAddMenu: View {
    @Environment(Store.self) private var store
    /// The actions this draft can take. A picked event leaves out Date and Repeat, which it stands in for.
    let buttons: [QuickAddButton]
    let priority: Priority
    let onPriority: @MainActor (Priority) -> Void
    let onImage: @MainActor (ImageSource) -> Void
    let run: @MainActor (QuickAddButton) -> Void

    var body: some View {
        Menu {
            Section {
                ForEach(buttons) { button in
                    if button == .priority {
                        Menu {
                            Picker("Priority", selection: Binding(get: { priority }, set: onPriority)) {
                                ForEach(Priority.allCases, id: \.self) { level in
                                    SwiftUI.Label { Text(Format.priorityLabel(level)) } icon: { level.flag }.tag(level)
                                }
                            }
                            .pickerStyle(.inline)
                        } label: {
                            SwiftUI.Label(button.name, systemImage: button.systemImage)
                        }
                        .menuOrder(.fixed)
                    } else if button == .images {
                        Menu {
                            ImageSourceButtons { onImage($0) }
                        } label: {
                            SwiftUI.Label(button.name, systemImage: button.systemImage)
                        }
                    } else {
                        Button(button.name, systemImage: button.systemImage) { run(button) }
                    }
                }
            }
            Menu {
                ForEach(QuickAddButton.allCases) { button in
                    Toggle(isOn: Binding(
                        get: { store.quickAddButtons.contains(button) },
                        set: { _ in store.setQuickAddButtons(QuickAddButtons.toggleButton(store.quickAddButtons, button)) }
                    )) {
                        SwiftUI.Label(button.name, systemImage: button.systemImage)
                    }
                }
                .menuActionDismissBehavior(.disabled)
            } label: {
                SwiftUI.Label("Customize row", systemImage: "pin")
            }
        } label: {
            Image(systemName: "plus")
                .imageScale(.small)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.muted)
                .frame(width: QuickAddMetrics.cornerButton, height: QuickAddMetrics.cornerButton)
                .background(Color.ink.opacity(0.06), in: .circle)
                .contentShape(.rect.inset(by: -6))
        }
        .menuOrder(.fixed)
        .accessibilityLabel("More quick add actions")
    }
}
